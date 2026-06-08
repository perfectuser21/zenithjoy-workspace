// line02-lead-gen stub preflight
// 空壳模块：无真实环境依赖，恒通过。
// 加厚时替换为真实检测 + fixGuide（参考 line04/preflight.ts）。
export async function runPreflight(
  _moduleDir: string
): Promise<{ ok: boolean; checks: Record<string, unknown> }> {
  return { ok: true, checks: {} };
}
