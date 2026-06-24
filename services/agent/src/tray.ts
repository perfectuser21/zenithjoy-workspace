// services/agent/src/tray.ts
//
// 系统托盘 — 用 systray2 实现轻量托盘图标 + 右键菜单
//
// 设计原则：
//   - 不阻塞主进程；托盘启动失败也不要 crash agent（headless 容器场景常见）
//   - 图标是占位图，启动时从 build/tray-icon.png 读取并 base64 化
//   - 状态机：connecting / online / offline，菜单上显示当前状态
//
// 注意：systray2 需要平台 helper 二进制（tray_windows.exe / tray_darwin / tray_linux），
//       pkg 打包时通过 pkg.assets 把这些 helper 打进 .exe 内的虚拟 fs。
//       systray2 自身在启动时会把 helper 抽到 OS tmp 目录然后 exec 之。

import fs from 'node:fs';
import path from 'node:path';

// 悦升云端 logo 内嵌兜底（32x32 PNG，base64）——
// 即使 pkg 虚拟 FS 读 build/tray-icon.png 失败，托盘也显悦升云端 logo，
// 绝不再回退到 1x1 透明 PNG（=用户看到的空白托盘，Issue 5c770b55）。
// 来源 build/tray-icon.png 缩 32x32 -strip 后 base64；与 exe 应用图标 build/icon.ico 同 logo。
const FALLBACK_TRAY_ICON_BASE64 =
  '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' +
  'AABJRU5ErkJggg==';

type TrayStatus = 'connecting' | 'online' | 'offline';

interface TrayHandlers {
  version: string;
  agentId: string;
  onRestart: () => void;
  onQuit: () => void;
}

let systray: any = null;
let trayReady = false;
let currentStatus: TrayStatus = 'connecting';
let handlers: TrayHandlers | null = null;
// Sprint 06081700 — 动态模块态：lineId → { 中文名, 是否运行中 }，由 ModuleManager 经 heartbeat 推送。
// running=true → 「● 运行中」；running=false → 「○ 待安装」。
export interface TrayModuleInfo {
  label: string;
  running: boolean;
}
let currentModules: Record<string, TrayModuleInfo> = {};
// 模块预检失败的「托盘红点」降级态：node-notifier 不可用时记录最近一条错误，
// 经 systray2 重建路径渲染成红点菜单项（绝不回退到任何外部弹窗进程）。
let lastModuleError: string | null = null;

function statusLabel(): string {
  switch (currentStatus) {
    case 'online':
      return '状态：在线';
    case 'offline':
      return '状态：离线';
    default:
      return '状态：连接中…';
  }
}

function loadIconBase64(): string {
  // pkg 把 build/tray-icon.png 标为 asset，运行时从虚拟 fs 读取
  // 候选路径：
  //   1. process.cwd 旁边的 build/
  //   2. exe 同目录的 build/
  //   3. snapshot 内（pkg）：__dirname/../build/tray-icon.png
  const candidates = [
    path.join(__dirname, '..', 'build', 'tray-icon.png'),
    path.join(process.cwd(), 'build', 'tray-icon.png'),
    path.join(path.dirname(process.execPath), 'build', 'tray-icon.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p).toString('base64');
      }
    } catch {
      // ignore
    }
  }
  // 兜底：内嵌悦升云端 logo（非 1x1 透明，避免空白托盘）
  return FALLBACK_TRAY_ICON_BASE64;
}

export function startTray(h: TrayHandlers): void {
  handlers = h;

  // 动态 require：systray2 在某些容器/CI 环境会启动失败，
  // 用 try/catch 把它隔离掉，主进程依然能跑
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let SysTray: any;
  try {
    SysTray = require('systray2').default;
  } catch (err) {
    console.warn('[tray] systray2 加载失败（headless 继续）:', err);
    return;
  }

  const iconBase64 = loadIconBase64();

  // Sprint 06081700 — 动态渲染激活中的 Line 模块：
  //   running → 「{中文名} ● 运行中」 / 待安装 → 「{中文名} ○ 待安装」
  const moduleItems = Object.entries(currentModules).map(([lineId, info]) => ({
    title: info.running ? `${info.label} ● 运行中` : `${info.label} ○ 待安装`,
    tooltip: lineId,
    enabled: false,
    checked: false,
  }));

  // 模块预检失败降级红点：node-notifier 不可用时，把最近一条错误渲染成「🔴 …」菜单项
  const errorItems = lastModuleError
    ? [
        SysTray.separator,
        {
          title: `🔴 ${lastModuleError}`,
          tooltip: '模块预检失败',
          enabled: false,
          checked: false,
        },
      ]
    : [];

  try {
    systray = new SysTray({
    menu: {
      icon: iconBase64,
      title: 'ZenithJoy Agent',
      tooltip: `ZenithJoy Agent v${h.version}`,
      items: [
        {
          title: `ZenithJoy Agent v${h.version}`,
          tooltip: '',
          enabled: false,
          checked: false,
        },
        {
          title: statusLabel(),
          tooltip: '',
          enabled: false,
          checked: false,
        },
        {
          title: `ID: ${h.agentId}`,
          tooltip: '',
          enabled: false,
          checked: false,
        },
        ...(moduleItems.length > 0 ? [SysTray.separator, ...moduleItems] : []),
        ...errorItems,
        SysTray.separator,
        {
          title: '重启',
          tooltip: '重启 Agent 进程',
          enabled: true,
          checked: false,
        },
        {
          title: '退出',
          tooltip: '关闭 Agent',
          enabled: true,
          checked: false,
        },
      ],
    },
    debug: false,
    copyDir: true, // pkg 打包时把 helper 复制到可执行目录
  });

    systray.onClick((action: any) => {
      const t: string = action?.item?.title || '';
      if (t === '重启') handlers?.onRestart();
      else if (t === '退出') handlers?.onQuit();
    });

    // 不阻塞调用方
    systray
      .ready()
      .then(() => {
        trayReady = true;
        pushStatusToTray();
      })
      .catch((err: unknown) => {
        console.warn('[tray] ready 失败（headless 继续）:', err);
        systray = null;
      });

    // systray 子进程退出时不要 unhandledRejection 起来
    if (systray && (systray as any)._process) {
      (systray as any)._process.on('error', (err: Error) => {
        console.warn('[tray] helper process error:', err.message);
        systray = null;
        trayReady = false;
      });
    }
  } catch (err) {
    console.warn('[tray] new SysTray 失败（headless 继续）:', err);
    systray = null;
  }
}

function pushStatusToTray(): void {
  if (!systray || !trayReady) return;
  try {
    systray.sendAction({
      type: 'update-item',
      item: {
        title: statusLabel(),
        tooltip: '',
        enabled: false,
        checked: false,
      },
      seq_id: 1,
    });
  } catch {
    // ignore
  }
}

export function updateTrayStatus(status: TrayStatus): void {
  currentStatus = status;
  pushStatusToTray();
}

// 重建托盘的实际实现，抽成可注入的 hook 对象（CJS 模式下 vi.spyOn 无法拦截内部直接调用）
export const _trayRebuildHook = {
  invoke(h: TrayHandlers): void {
    destroyTray();
    startTray(h);
  },
};

export function updateTrayModules(modules: Record<string, TrayModuleInfo>): void {
  const wasEmpty = Object.keys(currentModules).length === 0;
  currentModules = modules;
  // systray2 不支持运行时增删菜单项；首次出现模块时（0→N）整体重建托盘使模块条目可见。
  if (wasEmpty && Object.keys(modules).length > 0 && handlers) {
    _trayRebuildHook.invoke(handlers);
  }
}

// 原生通知发送抽成可注入 hook（CJS 下 vi.mock 无法拦截源码内 require('node-notifier')，
// 单测需可注入一个「必失败」实现来真验降级红点分支）。默认实现 = 动态 require node-notifier。
// notify 抛错（依赖缺失或原生调用失败）即视为不可用，落入降级路径。
export const _notifierHook = {
  notify(title: string, message: string): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notifier = require('node-notifier');
    notifier.notify({ title, message });
  },
};

// preflight 失败时提示客户「{模块名}」无法启用：{原因}。
// 两档静默通知，绝不弹任何外部窗口进程（去黑窗硬保证 —— 已彻底删除旧 PS 气泡弹窗档）：
//   1. node-notifier（跨平台原生图形通知，首选）
//   2. 降级「托盘红点 + 日志」：node-notifier 不可用时记录错误并经 systray2 既有重建路径
//      （_trayRebuildHook / updateTrayModules）让 🔴 菜单项可见，最后兜底 console.warn。
// 任何分支都不 spawn 子进程弹窗，不 crash agent。
export function showModuleError(moduleName: string, reason: string): void {
  const title = 'ZenithJoy 模块预检';
  const message = `「${moduleName}」无法启用：${reason}`;

  // 1. node-notifier（跨平台原生图形通知，若依赖存在）
  try {
    _notifierHook.notify(title, message);
    return;
  } catch {
    // node-notifier 不可用 —— 降级，绝不回退到外部弹窗进程
  }

  // 2. 降级「托盘红点 + 日志」：沿用 systray2 既有重建路径，不新引第二套重建逻辑。
  lastModuleError = message;
  console.warn(`[preflight] ${message}`);
  if (handlers) {
    // systray2 不支持运行时增删菜单项 → 复用 _trayRebuildHook 整体重建，使 🔴 红点条目可见
    _trayRebuildHook.invoke(handlers);
  }
}

export function destroyTray(): void {
  if (systray) {
    try {
      systray.kill(false);
    } catch {
      // ignore
    }
    systray = null;
  }
}

// 仅供单测使用：重置模块级别状态（systray2 实例无法在测试环境真启动）
export function _resetTrayStateForTest(): void {
  systray = null;
  trayReady = false;
  currentStatus = 'connecting';
  handlers = null;
  currentModules = {};
  lastModuleError = null;
}

// 仅供单测使用：直接设置 handlers 而不启动 systray2
export function _setHandlersForTest(h: TrayHandlers | null): void {
  handlers = h;
}

// 仅供单测使用：读取降级态 lastModuleError（验证 showModuleError 红点降级路径真生效）
export function _getLastModuleErrorForTest(): string | null {
  return lastModuleError;
}

// 仅供单测使用：读取内嵌悦升云端兜底图标 base64（验证兜底非 1x1 透明空白）
export function _getFallbackIconBase64ForTest(): string {
  return FALLBACK_TRAY_ICON_BASE64;
}

// 仅供单测使用：在所有候选路径都不存在时走兜底分支（验证返回的是悦升云端 logo 而非空白）
export function _loadIconBase64ForTest(): string {
  return loadIconBase64();
}
