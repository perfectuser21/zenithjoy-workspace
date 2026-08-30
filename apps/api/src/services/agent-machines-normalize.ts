/** 机器行规范化（从 routes/agent-machines.ts 抽出，供 workers 读面复用；行为不变） */
export const VALID_OWNER_TYPES = ['internal_fleet', 'customer'] as const;
export type OwnerType = typeof VALID_OWNER_TYPES[number];
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;
/** SQL 侧同口径：a.last_seen > NOW() - INTERVAL '3 minutes' */
export const ONLINE_WINDOW_SQL = "a.last_seen > NOW() - INTERVAL '3 minutes'";
export interface NormalizedMachine {
  id: unknown; agent_id: unknown; hostname: unknown; nickname: unknown; machine_role: unknown;
  os_type: unknown; owner_type: OwnerType; status: string; version: unknown; last_seen: unknown;
  session_count: number; offline_minutes: number | null;
}
export function normMachine(row: Record<string, unknown>): NormalizedMachine {
  const status = typeof row.status === 'string' ? row.status
    : row.last_seen && Date.now() - new Date(row.last_seen as string).getTime() <= ONLINE_WINDOW_MS ? 'online' : 'offline';
  let offlineMinutes: number | null = null;
  if (status !== 'online' && row.last_seen) offlineMinutes = Math.floor((Date.now() - new Date(row.last_seen as string).getTime()) / 60000);
  return { id: row.id, agent_id: row.agent_id, hostname: row.hostname, nickname: row.nickname, machine_role: row.machine_role,
    os_type: row.os_type ?? null, owner_type: (row.owner_type as OwnerType) ?? 'customer', status, version: row.version,
    last_seen: row.last_seen, session_count: Number(row.session_count ?? 0), offline_minutes: offlineMinutes };
}
