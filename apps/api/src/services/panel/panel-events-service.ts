/**
 * apps/api/src/services/panel/panel-events-service.ts — 作战窗刀1 events 表薄写入
 *
 * PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md
 * 按 tenant_id 隔离（系统级不变量）；纯 INSERT，无 ORM，直接 pool.query()
 * （仿 apps/api/src/services/wechat/tenant-memory.ts 范式）。
 */

import pool from '../../db/connection';

export type PanelEventType = 'task_started' | 'step' | 'waiting' | 'stuck' | 'done' | 'failed';

export interface WritePanelEventInput {
  tenantId: string;
  event: PanelEventType;
  taskId: string;
  line: string;
  device: string;
  title: string;
  detail?: string | null;
  progress?: [number, number] | null;
  severity?: 'info' | 'warn' | 'error';
}

export async function writePanelEvent(input: WritePanelEventInput): Promise<{ id: string }> {
  const res = await pool.query(
    `INSERT INTO zenithjoy.panel_events
       (tenant_id, task_id, event, line, device, title, detail, progress, severity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.tenantId,
      input.taskId,
      input.event,
      input.line,
      input.device,
      input.title,
      input.detail ?? null,
      input.progress ? JSON.stringify(input.progress) : null,
      input.severity ?? 'info',
    ],
  );
  return { id: res.rows[0].id };
}
