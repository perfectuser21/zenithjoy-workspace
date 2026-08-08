/**
 * login.mjs — 采证器登录模式（发版验收双表 · 刀2.2）
 *
 * 为什么要它：刀2 首轮每轮新注册 → 租户下零设备 → 链路格（任务/视频/线索/派单）
 * 全部只能如实标「无法验证」。用已绑真机设备的常驻验收账号登录，链路格才有东西可验。
 *
 * 凭据来源（优先级 cli > env，都没有 → ai_incomplete 告警退出）：
 *   --email/--password 命令行
 *   STAGING_ACCEPTANCE_EMAIL / STAGING_ACCEPTANCE_PASSWORD 环境变量（D2 规范化）
 *   ACCEPTANCE_EMAIL / ACCEPTANCE_PASSWORD 环境变量（兼容旧变量名）
 * 凭据本体存 1Password CS「ZenithJoy AI验收账号 (staging常驻)」，不入库不进日志。
 */

/** 解析凭据 → { mode: 'login'|'ai_incomplete', email, password, source } */
export function resolveCredentials(cli = {}, env = {}) {
  const cliEmail = cli.email || null;
  const cliPassword = cli.password || null;
  // 优先读 D2 规范化变量名，兼容旧变量名
  const envEmail = env.STAGING_ACCEPTANCE_EMAIL || env.ACCEPTANCE_EMAIL || null;
  const envPassword = env.STAGING_ACCEPTANCE_PASSWORD || env.ACCEPTANCE_PASSWORD || null;

  const email = cliEmail || envEmail;
  const password = cliPassword || envPassword;
  const source = cliEmail || cliPassword ? 'cli' : (envEmail || envPassword ? 'env' : null);

  if (!email && !password) {
    // D2：无凭据 → ai_incomplete 告警退出（不产生任何采集）
    return {
      mode: 'ai_incomplete',
      ai_incomplete: true,
      error: '无凭据：未设置 STAGING_ACCEPTANCE_EMAIL / STAGING_ACCEPTANCE_PASSWORD，整轮以 ai_incomplete 退出',
      email: null,
      password: null,
      source: null,
    };
  }
  if (email && !password) {
    throw new Error('登录模式缺少密码：给了邮箱就必须给密码（--password 或 STAGING_ACCEPTANCE_PASSWORD）');
  }
  if (!email && password) {
    throw new Error('登录模式缺少邮箱：给了密码就必须给邮箱（--email 或 STAGING_ACCEPTANCE_EMAIL）');
  }
  return { mode: 'login', email, password, source };
}

/** 运行摘要（写进证据包；绝不含密码） */
export function buildRunSummary({ mode, email, staging, machinesOnline, triggerCollectCount, aiIncomplete, versionStamp }) {
  return {
    mode,
    account: email || null,
    staging_url: staging || null,
    machines_online: typeof machinesOnline === 'number' ? machinesOnline : null,
    tenant_ok: mode === 'login',
    version_stamp: versionStamp || { captured_at: new Date().toISOString(), backend_sha: null, frontend_sha: null },
    trigger_collect_count: typeof triggerCollectCount === 'number' ? triggerCollectCount : 0,
    ai_incomplete: aiIncomplete === true,
    note: mode === 'login'
      ? '常驻验收账号登录（凭据在 1Password CS「ZenithJoy AI验收账号 (staging常驻)」）'
      : mode === 'ai_incomplete'
        ? '无凭据：整轮以 ai_incomplete 退出，不产生任何采集'
        : '未知模式',
  };
}

/** 在页面上执行登录；成功返回 true */
export async function performLogin(page, stagingUrl, email, password) {
  await page.goto(`${stagingUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const pwdInput = page.locator('input[type="password"]').first();
  await emailInput.fill(email, { timeout: 8000 });
  await pwdInput.fill(password, { timeout: 8000 });
  await page.locator('button[type="submit"], button:has-text("登录")').first().click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  // 登录成功判据：不再停留在登录页
  return !page.url().includes('/login');
}
