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
