// services/agent/src/shared/playwright-launcher.ts
//
// Playwright 共享底座 — 统一 chromium launcher 加载入口（Sprint cp-06261900）
//
// 根治的根：qr-bind-douyin-burner / douyin-dm-outreach / keyword-search-douyin 三个 handler
// 各自 import('playwright')（完整包）。pkg 打包只打进 playwright-core（见 package.json pkg.assets），
// 完整 playwright 没进包 → 打包真机 .exe 跑这三个 handler 必报「playwright 未安装」。
// publisher / qr-bind-operator 一直走对的共享模式（spawn .cjs require playwright-core / 直接 playwright-core）。
//
// 本模块统一出口 loadChromium()：
//   - 动态 import 优先 playwright-core（包里有的那个），失败回退完整 playwright
//   - 动态 import 用 new Function 包装，绕过 pkg 二进制内对 playwright 的静态 require 在 Node 18+ 的
//     "Invalid host defined options" VFS 崩溃（与 qr-bind-operator 注释的 workaround 同理）
//   - 都失败 → 抛清晰错误（含 playwright-core 字样，真机一眼定位）
//   - options.chromiumLauncher 注入 → 直接透传（单测/复用已开浏览器）
//   - options.chromiumLoader 注入 → 替换底层 import（单测不打真实包）

// chromium launcher 的最小结构（三个 handler 各取所需：launch / connectOverCDP / launchPersistentContext）
export interface ChromiumLike {
  launch?(opts?: Record<string, unknown>): Promise<unknown>;
  connectOverCDP?(url: string): Promise<unknown>;
  launchPersistentContext?(dir: string, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface LoadChromiumOptions {
  // 直接注入 chromium launcher（单测 / 复用已开浏览器）→ 不走动态 import
  chromiumLauncher?: ChromiumLike;
  // 替换底层动态 import（单测专用，不打真实 playwright 包）
  chromiumLoader?: (moduleName: string) => Promise<{ chromium?: ChromiumLike }>;
}

// 动态 import 包装：用 new Function 生成 import()，绕过 pkg 把顶层 require/import 静态截获后崩溃。
// pkg 不会改写 Function 体内的 import，运行时从真实 FS 的 node_modules 加载。
function defaultLoader(moduleName: string): Promise<{ chromium?: ChromiumLike }> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const dynImport = new Function('m', 'return import(m)') as (
    m: string,
  ) => Promise<{ chromium?: ChromiumLike }>;
  return dynImport(moduleName);
}

// 加载顺序：playwright-core（包里打进的）优先，失败回退完整 playwright。
const PREFERRED_MODULES = ['playwright-core', 'playwright'] as const;

/**
 * 统一加载 chromium launcher。
 * 三个掉队 handler 都改调本函数，保留各自 channel/headless/connectOverCDP 行为不变。
 */
export async function loadChromium(options: LoadChromiumOptions = {}): Promise<ChromiumLike> {
  if (options.chromiumLauncher) {
    return options.chromiumLauncher;
  }

  const loader = options.chromiumLoader ?? defaultLoader;
  const errors: string[] = [];

  for (const moduleName of PREFERRED_MODULES) {
    try {
      const mod = await loader(moduleName);
      if (mod?.chromium) {
        return mod.chromium;
      }
      errors.push(`${moduleName}: 模块已加载但缺 chromium 导出`);
    } catch (err) {
      errors.push(`${moduleName}: ${(err as Error).message}`);
    }
  }

  throw new Error(
    `无法加载 playwright-core（也回退 playwright 失败）；客户机需先装 playwright-core 或 playwright。` +
      `详情：${errors.join(' | ')}`,
  );
}
