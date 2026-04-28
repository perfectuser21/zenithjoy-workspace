import pool from '../db/connection';
import type { SkillStatusItem } from '../schemas/agent-protocol';

export interface SkillRow {
  id: string;
  slug: string;
  platform: string;
  category: string;
  name: string;
  content_type: string | null;
  is_dryrun: boolean;
  script_path: string;
  description: string | null;
  active: boolean;
}

export interface AgentSkillStatusRow {
  agent_id: string;
  skill_slug: string;
  status: string;
  last_check: string;
  last_error: string | null;
}

export async function listSkills(): Promise<SkillRow[]> {
  const { rows } = await pool.query<SkillRow>(
    `SELECT id, slug, platform, category, name, content_type, is_dryrun, script_path, description, active
     FROM zenithjoy.skills
     WHERE active = true
     ORDER BY platform, category, name`
  );
  return rows;
}

export async function upsertAgentSkillStatuses(
  agentId: string,
  skills: SkillStatusItem[]
): Promise<void> {
  if (!skills.length) return;

  const rows = skills
    .map((_, i) => {
      const b = i * 4;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, now(), now())`;
    })
    .join(', ');

  const params: (string | null)[] = skills.flatMap((s) => [
    agentId,
    s.slug,
    s.status,
    s.error ?? null,
  ]);

  await pool.query(
    `INSERT INTO zenithjoy.agent_skill_status
       (agent_id, skill_slug, status, last_error, last_check, updated_at)
     VALUES ${rows}
     ON CONFLICT (agent_id, skill_slug) DO UPDATE
       SET status     = EXCLUDED.status,
           last_error = EXCLUDED.last_error,
           last_check = now(),
           updated_at = now()`,
    params
  );
}

export async function getAgentSkillStatuses(
  agentId: string
): Promise<AgentSkillStatusRow[]> {
  const { rows } = await pool.query<AgentSkillStatusRow>(
    `SELECT agent_id, skill_slug, status, last_check, last_error
     FROM zenithjoy.agent_skill_status
     WHERE agent_id = $1`,
    [agentId]
  );
  return rows;
}

export async function getAllAgentSkillStatuses(): Promise<AgentSkillStatusRow[]> {
  const { rows } = await pool.query<AgentSkillStatusRow>(
    `SELECT agent_id, skill_slug, status, last_check, last_error
     FROM zenithjoy.agent_skill_status
     ORDER BY agent_id, skill_slug`
  );
  return rows;
}
