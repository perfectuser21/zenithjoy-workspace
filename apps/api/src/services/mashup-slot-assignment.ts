// apps/api/src/services/mashup-slot-assignment.ts
//
// 批量混剪 S2（GP f6f96e17）：把客户选定的模板槽位（钩子/产品/证据/CTA）
// 分配到 S1 已打标签的素材上。
//
// 打分方法：槽位 match_tags 与素材 ai_tags 的重叠计数，取分最高且未被其他槽位
// 占用的素材（贪心，槽位按模板定义顺序处理）。0 分不算命中——宁可槽位空着走
// J4 降级分支，也不要硬凑一个不相关的素材进去。
//
// 补拍降级（决策 98d1fab1 / proposal-v2.md J4）：Seedance/HappyHorse 账号未配置，
// 必填槽位缺素材时不尝试补拍调用，直接落 reshoot_skipped——这是已定义好的
// contingency，不是新决策。哪天账号配好了，只需在这里加一段真实调用，
// 调用失败再落回 reshoot_skipped，调用方看到的状态语义不变。

import axios from 'axios';
import pool from '../db/connection';

export interface SlotDef {
  key: string;
  required: boolean;
  match_tags: string[];
}

export interface AssignSlotsInput {
  tenantId: string;
  templateId: string;
  materialIds: string[];
}

export type SlotAssignmentStatus = 'assigned' | 'reshoot_skipped' | 'unfilled';

export interface SlotAssignmentResult {
  slotKey: string;
  materialId?: string;
  status: SlotAssignmentStatus;
  reason?: string;
}

export interface AssignSlotsResult {
  runId: string;
  status: 'completed' | 'completed_partial';
  assignments: SlotAssignmentResult[];
}

interface MaterialRow {
  id: string;
  ai_tags: string[] | null;
}

function reshootConfigured(): boolean {
  return Boolean(process.env.SEEDANCE_API_KEY || process.env.HAPPYHORSE_API_KEY);
}

function scoreOverlap(materialTags: string[] | null, slotTags: string[]): number {
  if (!materialTags || materialTags.length === 0) return 0;
  const tagSet = new Set(materialTags);
  return slotTags.reduce((acc, t) => acc + (tagSet.has(t) ? 1 : 0), 0);
}

export async function assignSlots(input: AssignSlotsInput): Promise<AssignSlotsResult> {
  const { rows: tmplRows } = await pool.query(
    `SELECT id, tenant_id, name, slots FROM zenithjoy.mashup_templates WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
    [input.templateId, input.tenantId],
  );
  const template = tmplRows[0] as { slots: SlotDef[] } | undefined;
  if (!template) {
    throw new Error(`template not found: ${input.templateId}`);
  }

  let materials: MaterialRow[] = [];
  if (input.materialIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, ai_tags FROM zenithjoy.materials WHERE tenant_id = $1 AND tag_status = 'tagged' AND id = ANY($2::uuid[])`,
      [input.tenantId, input.materialIds],
    );
    materials = rows as MaterialRow[];
  }

  const { rows: runRows } = await pool.query(
    `INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [input.tenantId, input.templateId],
  );
  const runId: string = runRows[0].id;

  const used = new Set<string>();
  const assignments: SlotAssignmentResult[] = [];

  for (const slot of template.slots) {
    let best: { id: string; score: number } | null = null;
    for (const m of materials) {
      if (used.has(m.id)) continue;
      const score = scoreOverlap(m.ai_tags, slot.match_tags);
      if (score > 0 && (!best || score > best.score)) {
        best = { id: m.id, score };
      }
    }

    if (best) {
      used.add(best.id);
      assignments.push({ slotKey: slot.key, materialId: best.id, status: 'assigned' });
    } else if (slot.required) {
      assignments.push({
        slotKey: slot.key,
        status: 'reshoot_skipped',
        reason: reshootConfigured() ? 'reshoot_failed' : 'reshoot_service_not_configured',
      });
    } else {
      assignments.push({ slotKey: slot.key, status: 'unfilled', reason: 'no_eligible_material' });
    }
  }

  for (const a of assignments) {
    await pool.query(
      `INSERT INTO zenithjoy.mashup_slot_assignments (run_id, slot_key, material_id, status, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, a.slotKey, a.materialId ?? null, a.status, a.reason ?? null],
    );
  }

  const hasReshootSkipped = assignments.some((a) => a.status === 'reshoot_skipped');
  const runStatus: 'completed' | 'completed_partial' = hasReshootSkipped ? 'completed_partial' : 'completed';

  await pool.query(`UPDATE zenithjoy.mashup_runs SET status = $2 WHERE id = $1`, [runId, runStatus]);

  return { runId, status: runStatus, assignments };
}

// ── Step1 文案动态分段（GP line05/batch_mashup step1）─────────────────────
//
// 客户粘贴一段文案 → 调 TOAPIS/Gemini（复用 mashup-render.ts 同款 TOAPIS 代理，
// 不新增第三方账号）解析出动态分段结构 + 每段建议素材数，落成新 mashup_templates 行。
// AI 不可用（缺 key / 超时 / 鉴权 / 欠费 / 5xx / 网络 / 结构非法）统一归「AI 服务
// 不可用」→ 静默降级固定四槽位模板（非阻断，HTTP 仍 200）——判定点登记表选 A：
// 捕获所有异常统一归不可用，误判偏保守无面客错误。

/** S1 打标签用的 ai_tags 枚举（与内置标准四槽位模板 match_tags 同源）。
 *  角色标签命中此集合 → tagMapping='matched'；否则兜底映射 → 'fallback'。 */
const KNOWN_AI_TAGS = new Set<string>([
  '开场', '特写', '悬念', '冲突', '惊讶',
  '产品特写', '产品展示', '主体', '细节',
  '使用场景', '效果对比', '证据', '实拍',
  '行动号召', '下单', '购买', '咨询', '结尾',
]);

const FROM_SCRIPT_TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const FROM_SCRIPT_MODEL = 'gemini-2.5-flash-official';
const FROM_SCRIPT_TIMEOUT_MS = 18_000;
const FROM_SCRIPT_MAX_TOKENS = 800;

export type SlotTagMapping = 'matched' | 'fallback';

export interface DynamicSlot {
  key: string;
  required: boolean;
  match_tags: string[];
  suggestedCount: number;
  tagMapping: SlotTagMapping;
}

export interface GenerateTemplateFromScriptInput {
  tenantId: string;
  script: string;
}

export interface GenerateTemplateFromScriptResult {
  templateId: string;
  name: string;
  slots: DynamicSlot[];
  degraded: boolean;
  source: 'ai' | 'fallback';
}

/** 固定四槽位降级模板：AI 不可用时的兜底，非阻断。 */
function fallbackSlots(): DynamicSlot[] {
  return [
    { key: 'hook', required: true, match_tags: ['开场', '特写', '悬念'], suggestedCount: 3 },
    { key: 'product', required: true, match_tags: ['产品特写', '产品展示', '细节'], suggestedCount: 5 },
    { key: 'evidence', required: false, match_tags: ['使用场景', '效果对比', '证据'], suggestedCount: 4 },
    { key: 'cta', required: true, match_tags: ['行动号召', '下单', '结尾'], suggestedCount: 2 },
  ].map(enrichTagMapping);
}

/** 给槽位补 tagMapping：越界标签不落，命中枚举标 matched，否则 fallback（合同：
 *  match_tags 必须 ⊆ ai_tags 枚举，越界标 fallback 不落任意标签）。 */
function enrichTagMapping(slot: Omit<DynamicSlot, 'tagMapping'>): DynamicSlot {
  const filtered = slot.match_tags.filter((t) => KNOWN_AI_TAGS.has(t));
  return {
    ...slot,
    match_tags: filtered,
    tagMapping: filtered.length > 0 ? 'matched' : 'fallback',
  };
}

interface RawSegment {
  key?: unknown;
  match_tags?: unknown;
  suggestedCount?: unknown;
  required?: unknown;
}

/** 调 TOAPIS/Gemini 把文案解析成动态分段；缺 key / 任何异常 / 结构非法 → null（触发降级）。 */
async function segmentScriptWithAI(script: string): Promise<DynamicSlot[] | null> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    '你是短视频混剪脚本分段助手。把下面这段带货文案拆成有序的镜头分段。',
    '每段输出一个对象：key（英文小写短标识，如 hook/product/evidence/cta）、',
    'match_tags（从这个固定枚举里选命中的角色标签，可多选，选不到给空数组）：',
    [...KNOWN_AI_TAGS].join('/') + '。',
    'suggestedCount（该段建议素材数，正整数）、required（是否必填，布尔）。',
    '严格只输出 JSON 数组，不要任何解释文字。文案如下：',
    script,
  ].join('\n');

  try {
    const resp = await axios.post(
      `${FROM_SCRIPT_TOAPIS_BASE}/chat/completions`,
      {
        model: FROM_SCRIPT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: FROM_SCRIPT_MAX_TOKENS,
        temperature: 0.2,
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: FROM_SCRIPT_TIMEOUT_MS },
    );
    const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as RawSegment[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const slots: DynamicSlot[] = [];
    for (const seg of parsed) {
      const key = typeof seg.key === 'string' && seg.key.trim() ? seg.key.trim() : `seg${slots.length + 1}`;
      const matchTags = Array.isArray(seg.match_tags)
        ? seg.match_tags.filter((t): t is string => typeof t === 'string')
        : [];
      const suggestedCount = typeof seg.suggestedCount === 'number' && Number.isFinite(seg.suggestedCount) && seg.suggestedCount > 0
        ? Math.floor(seg.suggestedCount)
        : 3;
      const required = typeof seg.required === 'boolean' ? seg.required : true;
      slots.push(enrichTagMapping({ key, required, match_tags: matchTags, suggestedCount }));
    }
    return slots.length > 0 ? slots : null;
  } catch (err) {
    // 超时/鉴权/欠费/5xx/网络/解析异常统一归「AI 服务不可用」→ 降级（非阻断）。
    console.error('[mashup-from-script] AI 分段不可用，降级固定模板 reason=%s', (err as Error).message);
    return null;
  }
}

export async function generateTemplateFromScript(
  input: GenerateTemplateFromScriptInput,
): Promise<GenerateTemplateFromScriptResult> {
  const aiSlots = await segmentScriptWithAI(input.script);
  const degraded = aiSlots === null;
  const slots = aiSlots ?? fallbackSlots();
  const source: 'ai' | 'fallback' = degraded ? 'fallback' : 'ai';
  const name = degraded ? '固定四槽位（AI 降级）' : '文案动态分段';

  const { rows } = await pool.query(
    `INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [input.tenantId, name, JSON.stringify(slots)],
  );

  return { templateId: rows[0].id, name, slots, degraded, source };
}
