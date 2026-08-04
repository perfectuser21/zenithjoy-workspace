/**
 * login.mjs — 采证器登录模式（发版验收双表 · 刀2.1）
 *
 * 为什么要它：刀2 首轮每轮新注册 → 租户下零设备 → 链路格（任务/视频/线索/派单）
 * 全部只能如实标「无法验证」。用已绑真机设备的常驻验收账号登录，链路格才有东西可验。
 *
 * 凭据来源（优先级 cli > env，都没有 → 回落 signup 保持旧行为）：
 *   --email/--password 命令行
 *   ACCEPTANCE_EMAIL / ACCEPTANCE_PASSWORD 环境变量
 * 凭据本体存 1Password CS「ZenithJoy AI验收账号 (staging常驻)」，不入库不进日志。
 */

/** 解析凭据 → { mode: 'login'|'signup', email, password, source } */
export function resolveCredentials(cli = {}, env = {}) {
  const cliEmail = cli.email || null;
  const cliPassword = cli.password || null;
  const envEmail = env.ACCEPTANCE_EMAIL || null;
  const envPassword = env.ACCEPTANCE_PASSWORD || null;

  const email = cliEmail || envEmail;
  const password = cliPassword || envPassword;
  const source = cliEmail || cliPassword ? 'cli' : (envEmail || envPassword ? 'env' : null);

  if (!email && !password) {
    return { mode: 'signup', email: null, password: null, source: null };
  }
  if (email && !password) {
    throw new Error('登录模式缺少密码：给了邮箱就必须给密码（--password 或 ACCEPTANCE_PASSWORD）');
  }
  if (!email && password) {
    throw new Error('登录模式缺少邮箱：给了密码就必须给邮箱（--email 或 ACCEPTANCE_EMAIL）');
  }
  return { mode: 'login', email, password, source };
}

/** 运行摘要（写进证据包；绝不含密码） */
export function buildRunSummary({ mode, email, staging, machinesOnline }) {
  return {
    mode,
    account: email || null,
    staging_url: staging || null,
    machines_online: typeof machinesOnline === 'number' ? machinesOnline : null,
    note: mode === 'login'
      ? '常驻验收账号登录（凭据在 1Password CS「ZenithJoy AI验收账号 (staging常驻)」）'
      : '本轮新注册账号（租户下无绑定设备，链路格将标无法验证）',
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
