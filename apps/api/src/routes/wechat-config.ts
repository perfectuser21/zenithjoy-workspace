/**
 * /api/wechat/* — Path 4 微信客服「中台配置」端点（Sprint B）
 *
 * 把 Sprint A 写死在 apps/api/config/*.json 的人设 + 企业知识库「搬上中台」：
 * 运营在页面填、保存即生效（落 zenithjoy.wechat_cs_config，经 cs-config-store 存取）。
 *
 * 5 个端点（鉴权与同 router 其他 /api/wechat/* 端点一致：不挂 superAdminGuard。
 *   原因：superAdminGuard 只认飞书白名单 / 内部 token，**不认 dashboard 的 better-auth
 *   登录 session** → 运营在中台的请求全被 401 拦，加载失败/存不进/AI帮填失败。
 *   中台已在 better-auth 登录 + nginx 后面，这些内部配置端点与 qr-bind/draft-generate
 *   等同 router 端点保持一致即可。后续如需更强鉴权，应换用 better-auth session 感知的中间件）：
 *   - GET  /api/wechat/persona                     → getPersona()
 *   - PUT  /api/wechat/persona                      → 校验 Persona → savePersona() → {success:true}
 *   - GET  /api/wechat/business-kb                  → getBusinessKB()
 *   - PUT  /api/wechat/business-kb                  → 校验 BusinessKB → saveBusinessKB() → {success:true}
 *   - POST /api/wechat/business-kb/suggest-audience → LLM 帮填 A1–A5 人群画像（不写库，前端拿去填表单）
 *
 * 路由路径相对挂载点（lead mount 到 /api/wechat），故此处写 '/persona' 等。
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-config-ui-design.md §2.4
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { callOpenRouter } from '../llm/openrouter';
import {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
  getAutoAgentConfig,
  saveAutoAgentConfig,
} from '../services/wechat/cs-config-store';
import { enqueueKeyContactBroadcast } from '../services/wechat/cs-outbound';
import { superAdminGuard } from '../middleware/super-admin';
import type { KBAudienceSegment } from '../services/wechat/types';

export const wechatConfigRouter = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const PersonaFewShotSchema = z.object({
  customer: z.string(),
  me: z.string(),
});

const PersonaSchema = z
  .object({
    self_name: z.string(),
    address_style: z.string(),
    tone: z.string(),
    sentence_style: z.string(),
    use_emoji: z.string(),
    banned_phrases: z.array(z.string()),
    few_shot: z.array(PersonaFewShotSchema),
  })
  .strict();

const KBCompanySchema = z
  .object({
    name: z.string(),
    what_we_do: z.string(),
    value_prop: z.string(),
    contact: z.string(),
  })
  .strict();

const KBProductSchema = z
  .object({
    name: z.string(),
    selling_points: z.string(),
    price: z.string().optional(),
  })
  .strict();

const KBAudienceSegmentSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    desc: z.string(),
  })
  .strict();

const KBQADocSchema = z
  .object({
    q: z.string(),
    a: z.string(),
  })
  .strict();

const BusinessKBSchema = z
  .object({
    company: KBCompanySchema,
    products: z.array(KBProductSchema),
    audience_segments: z.array(KBAudienceSegmentSchema),
    qa_docs: z.array(KBQADocSchema),
  })
  .strict();

const SuggestAudienceSchema = z
  .object({
    industry: z.string().min(1),
    products: z.string().optional(),
    value_prop: z.string().optional(),
  })
  .strict();

// ─── 校验失败响应（对齐 wechat.ts 的 {error, message, issues} 格式）───────────────

function invalidBody(res: Response, err: z.ZodError) {
  const issues = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  const fields = issues.map((i) => i.path).filter(Boolean).join(',');
  return res.status(400).json({
    error: 'INVALID_BODY',
    message: `字段校验失败: ${fields || 'body'}`,
    issues,
  });
}

// ─── ① 人设 Persona ────────────────────────────────────────────────────────────

wechatConfigRouter.get('/persona', async (_req: Request, res: Response) => {
  const persona = await getPersona();
  return res.status(200).json(persona);
});

wechatConfigRouter.put('/persona', async (req: Request, res: Response) => {
  const parsed = PersonaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  await savePersona(parsed.data);
  return res.status(200).json({ success: true });
});

// ─── ② 企业知识库 BusinessKB ────────────────────────────────────────────────────

wechatConfigRouter.get('/business-kb', async (_req: Request, res: Response) => {
  const kb = await getBusinessKB();
  return res.status(200).json(kb);
});

wechatConfigRouter.put('/business-kb', async (req: Request, res: Response) => {
  const parsed = BusinessKBSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  await saveBusinessKB(parsed.data);
  return res.status(200).json({ success: true });
});

// ─── ③ AI 帮填 A1–A5 人群画像 ────────────────────────────────────────────────────
// 不写库：前端拿返回的 audience_segments 填进表单，用户改完后再走 PUT /business-kb 保存。

/**
 * 从模型自由文本里抠出 JSON 并解析成 audience_segments。
 * 容错：剥 ```json 代码围栏、截取首个 {…} 块，再 JSON.parse。
 * 校验成功返回规整后的 KBAudienceSegment[]；任何失败返回 null。
 */
function parseAudienceSegments(raw: string): KBAudienceSegment[] | null {
  if (!raw) return null;
  let text = raw.trim();
  // 去掉 ```json ... ``` / ``` ... ``` 代码围栏
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 截取首个 { 到末个 } 之间的内容（容忍模型多说了话）
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonSlice = text.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(jsonSlice);
  } catch {
    return null;
  }
  const segs = (obj as { audience_segments?: unknown })?.audience_segments;
  if (!Array.isArray(segs)) return null;

  const cleaned: KBAudienceSegment[] = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    const code = (s as Record<string, unknown>).code;
    const label = (s as Record<string, unknown>).label;
    const desc = (s as Record<string, unknown>).desc;
    if (typeof code !== 'string' || typeof label !== 'string' || typeof desc !== 'string') continue;
    cleaned.push({ code: code.trim(), label: label.trim(), desc: desc.trim() });
  }
  return cleaned.length > 0 ? cleaned : null;
}

function buildSuggestPrompt(input: z.infer<typeof SuggestAudienceSchema>): string {
  const lines = [
    '你是资深私域获客顾问。请基于以下企业信息，提炼 5 类最值得重点触达的目标人群画像。',
    '',
    `行业：${input.industry}`,
  ];
  if (input.products) lines.push(`主营产品 / 服务：${input.products}`);
  if (input.value_prop) lines.push(`核心价值主张：${input.value_prop}`);
  lines.push(
    '',
    '严格只输出如下 JSON，不要任何解释、前后缀或代码围栏：',
    '{"audience_segments":[{"code":"A1","label":"人群名称","desc":"该人群的特征与需求一句话描述"}, ...]}',
    '要求：恰好 5 条，code 依次为 A1、A2、A3、A4、A5；label 简短；desc 一句话点出痛点 / 需求。',
  );
  return lines.join('\n');
}

wechatConfigRouter.post('/business-kb/suggest-audience', async (req: Request, res: Response) => {
  const parsed = SuggestAudienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);

  let content: string;
  try {
    const result = await callOpenRouter({
      prompt: buildSuggestPrompt(parsed.data),
      purpose: 'wechat_suggest_audience',
      maxTokens: 800,
    });
    content = result.content ?? '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[wechat-config/suggest-audience] callOpenRouter 异常:', message);
    return res.status(502).json({ error: 'LLM_FAILED', message });
  }

  const segments = parseAudienceSegments(content);
  if (!segments) {
    return res.status(400).json({ error: 'PARSE_FAILED', message: '模型未返回可解析的人群画像 JSON' });
  }

  return res.status(200).json({ audience_segments: segments });
});

// ─── ④ 自动代理配置（总开关 + 营业时间 + 关键人 + daily_limit）────────────────────
//
// PUT /api/wechat/cs/auto-agent（super-admin）：保存配置 + 在 auto_agent_enabled OFF↔ON
// 跳变时给关键人入「上下线播报」出站任务（agent 拉取后真机 UIA 发送）。

const AutoAgentConfigSchema = z
  .object({
    auto_agent_enabled: z.boolean().optional(),
    business_hours_start: z.string().optional(),
    business_hours_end: z.string().optional(),
    key_contact_wechat: z.string().optional(),
    daily_limit: z.number().int().min(0).optional(),
    // 播报出站任务归属的 agent（NOT NULL uuid）。thin：单租户由调用方传入。
    agent_id: z.string().uuid().optional(),
  })
  .strict();

wechatConfigRouter.get('/cs/auto-agent', superAdminGuard, async (_req: Request, res: Response) => {
  const cfg = await getAutoAgentConfig();
  return res.status(200).json(cfg);
});

wechatConfigRouter.put('/cs/auto-agent', superAdminGuard, async (req: Request, res: Response) => {
  const parsed = AutoAgentConfigSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  const { agent_id, ...cfgPatch } = parsed.data;

  // 跳变检测：取保存前的开关态 + 保存后的开关态
  const before = await getAutoAgentConfig();
  await saveAutoAgentConfig(cfgPatch);
  const after = await getAutoAgentConfig();

  // OFF↔ON 跳变 → 给关键人入上/下线播报出站任务（关键人未配 / 无跳变 → skip，不阻塞保存）。
  let broadcast: { action: string; task_id?: string } = { action: 'skip' };
  if (agent_id) {
    broadcast = await enqueueKeyContactBroadcast({
      prevOn: before.auto_agent_enabled,
      nextOn: after.auto_agent_enabled,
      keyContact: after.key_contact_wechat,
      agentId: agent_id,
    });
  }

  return res.status(200).json({ success: true, config: after, broadcast });
});

export default wechatConfigRouter;
