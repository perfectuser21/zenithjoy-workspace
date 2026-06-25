/**
 * 启动 env 自检（哨兵第一样板）
 *
 * 治根：2026-06-19 生产 mmv 的 apps/api/.env 漏了 TOAPI_API_KEY → 微信客服 AI 生成失败、
 * 静默不回（中台返回 ok 但无 reply，aiError 不打日志），排查很久。当时手动补 key——
 * 没有守卫，换机/重部署必再犯。本模块在启动早期大声自检关键 env，并把状态暴露到 /health。
 *
 * 设计纪律：
 * - 缺 key → console.error 大声打红日志（明确列缺哪些 + 后果），不静默。
 * - 不让进程崩（避免缺个非致命 key 直接挂掉生产），但响亮可见。
 * - 只列"缺了就会让核心功能静默坏掉"的 key，不列可选项（可选项有默认兜底，不进这里）。
 */

/**
 * 中台运行必须的【单 key】关键 env。缺任何一个，核心功能会静默坏掉：
 * - TOAPI_API_KEY：LLM 调用凭据（clients/toapi.client.ts / services/video-remake.service.ts）。
 *   缺失 → 微信客服 AI 生成会失败、静默不回（2026-06-19 真实事故根因）。
 * - BETTER_AUTH_SECRET：登录态签名密钥（auth.ts，生产缺失会直接 throw）。
 *   缺失 → 所有需要登录的接口全部 401，用户登不进。
 *
 * 注：数据库连接【不在此】——它是"二选一组"（见 REQUIRED_ENV_GROUPS），不是单 key 硬必需。
 * 治根（2026-06-25 假阳事故）：旧版把 DATABASE_URL 硬列进来，但 db/connection.ts 实际用拆分式
 * DATABASE_HOST/PORT/NAME/USER/PASSWORD，从不读 DATABASE_URL → 生产 config.ok=false /
 * missing DATABASE_URL 是假阳（DB 实际正常），污染蓝绿 /health 健康判定 + 验 staging 误导用户。
 */
export const REQUIRED_ENV: string[] = [
  'TOAPI_API_KEY',
  'BETTER_AUTH_SECRET',
];

/**
 * 必需的【二选一组】env：组内任一"备选"（alternative）满足，则该组算满足。
 * 一个 alternative = 一组必须【同时】齐的 key（AND）；多个 alternatives 之间是【或】（OR）。
 *
 * DB 连接组：DATABASE_URL（整串形态）  OR  DATABASE_HOST + DATABASE_NAME（拆分式，db/connection.ts 实际用）。
 * 既去掉"硬列 DATABASE_URL"的假阳，又保留对"真没配库"的防呆（两种形态都没配 → 仍报红）。
 */
export interface RequiredEnvGroup {
  label: string;            // 组名（用于日志/missing 展示）
  alternatives: string[][]; // 每个备选 = 一组 AND 的 key；备选之间 OR
  consequence: string;      // 整组都不满足时的后果说明
}
export const REQUIRED_ENV_GROUPS: RequiredEnvGroup[] = [
  {
    label: 'DATABASE_URL | (DATABASE_HOST+DATABASE_NAME)',
    alternatives: [['DATABASE_URL'], ['DATABASE_HOST', 'DATABASE_NAME']],
    consequence: '数据库连接两种形态都没配（整串 DATABASE_URL 或 拆分式 HOST+NAME）→ 数据读写全部失败',
  },
];

/**
 * 缺各 key 的后果说明（用于大声日志，让运维一眼看懂影响面）。
 */
const CONSEQUENCE: Record<string, string> = {
  TOAPI_API_KEY: '微信客服 AI 生成会失败、静默不回（2026-06-19 生产事故根因）',
  BETTER_AUTH_SECRET: '登录态签名缺失 → 所有需登录接口 401，用户登不进',
};

/**
 * 完整性闸门数据源：声明"哪个关键 key 在哪个源码文件被 process.env.X 读取"。
 * 测试（startup-check.test.ts）会扫这些文件真实源码，断言 key 确实被读取且已进 REQUIRED_ENV。
 * 以后谁加了新的关键 env 读取，在这里补一行 + 进 REQUIRED_ENV，否则闸门红、合不进。
 *
 * 注：DATABASE_URL 当前由部署环境注入连接池（非源码内 process.env 直读），故不在此列；
 * 这里只放"源码内确有 process.env.<KEY> 读取"的关键 key，保证闸门断言为真。
 */
export const CRITICAL_ENV_USAGE: { key: string; file: string }[] = [
  { key: 'TOAPI_API_KEY', file: 'clients/toapi.client.ts' },
  { key: 'BETTER_AUTH_SECRET', file: 'auth.ts' },
];

export interface StartupConfigResult {
  ok: boolean;
  missing: string[];
  present: string[];
}

// 单个 env key 是否存在且非空（空串/纯空白算缺失）。
function _hasEnv(env: Record<string, string | undefined>, key: string): boolean {
  const val = env[key];
  return !(val == null || String(val).trim() === '');
}

/**
 * 查 ① REQUIRED_ENV（单 key 硬必需）+ ② REQUIRED_ENV_GROUPS（二选一组）是否都满足。
 * 组：任一备选（一组 AND 的 key 全齐）满足则该组满足；所有备选都不满足 → 把组 label 计入 missing。
 */
export function verifyStartupConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StartupConfigResult {
  const missing: string[] = [];
  const present: string[] = [];
  // ① 单 key 硬必需
  for (const key of REQUIRED_ENV) {
    if (_hasEnv(env, key)) present.push(key);
    else missing.push(key);
  }
  // ② 二选一组：任一备选全齐即满足
  for (const group of REQUIRED_ENV_GROUPS) {
    const satisfied = group.alternatives.some((alt) => alt.every((k) => _hasEnv(env, k)));
    if (satisfied) present.push(group.label);
    else missing.push(group.label);
  }
  return { ok: missing.length === 0, missing, present };
}

/**
 * 启动早期调用：自检 + 大声打红日志（缺 key 列出后果），不崩进程。
 * 返回结果供 /health 暴露与冒烟使用。
 */
export function runStartupConfigCheck(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StartupConfigResult {
  const result = verifyStartupConfig(env);
  if (result.ok) {
    console.log(`✅ 启动 env 自检通过（${result.present.length}/${REQUIRED_ENV.length} 关键 key 就绪）`);
    return result;
  }
  console.error('==================================================================');
  console.error('🔴🔴🔴 启动 env 自检失败：缺少关键环境变量，核心功能会静默坏掉 🔴🔴🔴');
  for (const key of result.missing) {
    // missing 项可能是单 key（查 CONSEQUENCE）或二选一组的 label（查组的 consequence）。
    const group = REQUIRED_ENV_GROUPS.find((g) => g.label === key);
    const why = group ? group.consequence : (CONSEQUENCE[key] ?? '核心功能受影响');
    console.error(`🔴 缺失 ${key} → ${why}`);
  }
  console.error(`🔴 请检查部署机的 apps/api/.env，补齐：${result.missing.join(', ')}`);
  console.error('🔴 进程继续运行（避免单个 key 缺失直接挂生产），但相关功能不可用。');
  console.error('==================================================================');
  return result;
}
