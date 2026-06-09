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
  // 兜底：1x1 透明 PNG
  return (
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGA' +
    'WjzIeAAAAABJRU5ErkJggg=='
  );
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

// preflight 失败时本地弹窗提示客户「{模块名}」无法启用：{原因}。
// 优先 node-notifier（若安装），否则 Windows PowerShell 气泡通知，
// 非 Windows 或弹窗失败时静默降级（只打日志，绝不 crash agent）。
export function showModuleError(moduleName: string, reason: string): void {
  const title = 'ZenithJoy 模块预检';
  const message = `「${moduleName}」无法启用：${reason}`;

  // 1. node-notifier（跨平台原生通知，若依赖存在）
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notifier = require('node-notifier');
    notifier.notify({ title, message });
    return;
  } catch {
    // node-notifier 未安装，继续下一档
  }

  // 2. Windows PowerShell 气泡通知兜底
  if (process.platform === 'win32') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execFile } = require('node:child_process') as typeof import('node:child_process');
      const esc = (s: string) => s.replace(/'/g, "''");
      const ps =
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
        `$n.Icon = [System.Drawing.SystemIcons]::Warning; ` +
        `$n.BalloonTipTitle = '${esc(title)}'; ` +
        `$n.BalloonTipText = '${esc(message)}'; ` +
        `$n.Visible = $true; $n.ShowBalloonTip(10000); Start-Sleep -Seconds 11; $n.Dispose();`;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { windowsHide: true },
        () => {
          // 弹窗失败也不报错
        },
      );
      return;
    } catch {
      // PowerShell 不可用，静默降级
    }
  }

  // 3. 静默降级：只打日志
  console.warn(`[preflight] ${message}`);
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
}

// 仅供单测使用：直接设置 handlers 而不启动 systray2
export function _setHandlersForTest(h: TrayHandlers | null): void {
  handlers = h;
}
