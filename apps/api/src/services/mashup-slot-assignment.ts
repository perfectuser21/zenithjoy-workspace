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
