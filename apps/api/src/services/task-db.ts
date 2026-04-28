import pool from '../db/connection';

export interface Task {
  id: string;
  tenantId: string;
  agentId: string | null;
  agentText: string | null;
  skill: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function createTask(p: {
  tenantId: string;
  skill: string;
  params: Record<string, unknown>;
}): Promise<Task> {
  const { rows } = await pool.query<any>(
    `INSERT INTO zenithjoy.tasks (tenant_id, skill, params)
     VALUES ($1, $2, $3) RETURNING *`,
    [p.tenantId, p.skill, p.params]
  );
  return mapTask(rows[0]);
}

export async function getTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query<any>(
    'SELECT * FROM zenithjoy.tasks WHERE id = $1',
    [id]
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function listTasks(tenantId: string): Promise<Task[]> {
  const { rows } = await pool.query<any>(
    'SELECT * FROM zenithjoy.tasks WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100',
    [tenantId]
  );
  return rows.map(mapTask);
}

export async function startTask(id: string, agentText: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'running', agent_text = $2, started_at = now(), updated_at = now() WHERE id = $1`,
    [id, agentText]
  );
}

export async function finishTask(id: string, result: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'done', result = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
    [id, result]
  );
}

export async function failTask(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.tasks SET status = 'failed', error = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

function mapTask(r: any): Task {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    agentId: r.agent_id,
    agentText: r.agent_text,
    skill: r.skill,
    params: r.params,
    status: r.status,
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
