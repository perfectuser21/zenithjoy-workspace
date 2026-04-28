// services/agent/src/index.ts
//
// ZenithJoy Agent v1.0 — 后台进程入口（pkg 打包成单个 .exe）
//
// 设计原则：
//   - 没有 Electron / 没有主窗口
//   - 启动后台 ws 客户端 + 系统托盘图标（让客户感知 Agent 在跑）
//   - License 配置存 %APPDATA%/zenithjoy-agent/config.json
//   - 首次启动通过命令行参数 `--license=ZJ-XXXX` 注入，之后自动读 config

import WebSocket from 'ws';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { handleWechatPublish } from './handlers/wechat-publish';
import { handleDouyinPublish } from './handlers/douyin-publish';
import { handleKuaishouPublish } from './handlers/kuaishou-publish';
import { handleXiaohongshuPublish } from './handlers/xiaohongshu-publish';
import { handleToutiaoPublish } from './handlers/toutiao-publish';
import { handleWeiboPublish } from './handlers/weibo-publish';
import { handleShipinhaoPublish } from './handlers/shipinhao-publish';
import { handleZhihuPublish } from './handlers/zhihu-publish';
import { startTray, updateTrayStatus, destroyTray } from './tray';

// ---------- License & 配置 ----------

interface AgentConfig {
  licenseKey: string;
  agentId: string;
  apiUrl: string;
  loggedInAt: number;
  // v1.2 Day 1-2: register 后存的字段，旧 v1.1 config 没有，访问需 optional
  wsToken?: string;
  machineId?: string;
  registerApiUrl?: string;
  tier?: string;
  maxMachines?: number;
}

function getConfigDir(): string {
  // Windows: %APPDATA%/zenithjoy-agent
  // macOS:   ~/Library/Application Support/zenithjoy-agent
  // Linux:   ~/.config/zenithjoy-agent
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'zenithjoy-agent');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zenithjoy-agent');
  }
  return path.join(os.homedir(), '.config', 'zenithjoy-agent');
}

const CONFIG_DIR = getConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function readConfig(): AgentConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw);
    if (!cfg.licenseKey) return null;
    return cfg as AgentConfig;
  } catch (err) {
    console.warn('[agent] readConfig failed:', err);
    return null;
  }
}

function writeConfig(cfg: AgentConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function parseLicenseFromArgs(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--license='));
  if (!arg) return null;
  const val = arg.slice('--license='.length).trim();
  return val || null;
}

function loadOrInitConfig(): AgentConfig {
  // 优先用命令行参数（首次启动场景）
  const cliLicense = parseLicenseFromArgs();
  const existing = readConfig();

  if (cliLicense) {
    const cfg: AgentConfig = {
      licenseKey: cliLicense,
      agentId:
        existing?.agentId ||
        `agent-${safeHostnameSlug()}-${Date.now().toString(36)}`,
      apiUrl:
        process.env.ZENITHJOY_API_URL ||
        existing?.apiUrl ||
        'wss://api.zenithjoy.com/agent-ws',
      loggedInAt: Date.now(),
    };
    writeConfig(cfg);
    console.log(`[agent] license 已写入 ${CONFIG_FILE}`);
    return cfg;
  }

  if (existing) {
    return existing;
  }

  // 没 license，无法启动
  console.error('[agent] 未找到 license。请用 --license=ZJ-XXXX 启动一次以注入。');
  console.error(`[agent] 配置文件位置：${CONFIG_FILE}`);
  process.exit(2);
}

// ---------- WebSocket 业务核心 ----------

const VERSION = '1.0.0';

const startTime = Date.now();
let backoff = 1000;
const MAX_BACKOFF = 30000;

function makeMsg(type: string, payload: unknown, taskId?: string) {
  return {
    v: 1,
    type,
    msgId: crypto.randomUUID(),
    ...(taskId ? { taskId } : {}),
    ts: Date.now(),
    payload,
  };
}

function getCapabilities(): string[] {
  // 默认包含全部 8 个平台的 dry-run 能力（v0.3）
  // v1.1: 'xhs' → 'xiaohongshu'，与 dashboard pickFor('xiaohongshu') 对齐
  return (
    process.env.AGENT_CAPABILITIES ||
    'wechat,douyin,kuaishou,xiaohongshu,toutiao,weibo,shipinhao,zhihu'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// v1.1: hostname 含中文/特殊字符时，agentId 在 ws URL/ 数据库写入时会乱码或导致 path 不安全
// 用 NFKD 归一化后剔除非 ASCII，统一小写
function safeHostnameSlug(): string {
  const raw = os.hostname() || '';
  const slug = raw
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'unknown-host';
}

// v1.2: 硬件指纹 — hostname + 第一块网卡 mac 或 platform-arch，sha256
//   - 不是绝对唯一（VM 克隆可能撞），但日常单机够用
//   - 同一台机器重启不变 → register 续签同一记录
function computeMachineId(): string {
  const parts: string[] = [
    safeHostnameSlug(),
    process.platform,
    process.arch,
  ];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces).sort()) {
      const arr = ifaces[name] || [];
      for (const i of arr) {
        if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
          parts.push(i.mac);
          break;
        }
      }
      if (parts.length > 3) break;
    }
  } catch {
    // ignore — fall back to hostname+platform 已足够
  }
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32);
}

// v1.2: 调用 POST /api/agent/register 拿 ws_token
//   - 失败时打错误，让客户能看到具体原因（License invalid / Quota exceeded 等）
async function registerWithLicense(cfg: AgentConfig): Promise<{
  wsToken: string;
  machineId: string;
  tier?: string;
  maxMachines?: number;
} | null> {
  const machineId = cfg.machineId || computeMachineId();
  // wsApiUrl 是 wss://api.../agent-ws，注册端点是 https://api.../api/agent/register
  // 从 cfg.apiUrl 推导 https base：ws[s]:// → http[s]://，去掉 /agent-ws 后缀
  let httpBase = cfg.registerApiUrl || '';
  if (!httpBase) {
    httpBase = cfg.apiUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/agent-ws\/?$/, '');
  }
  const url = `${httpBase}/api/agent/register`;

  const body = JSON.stringify({
    license_key: cfg.licenseKey,
    machine_id: machineId,
    hostname: os.hostname() || undefined,
    agent_id: cfg.agentId,
    version: VERSION,
  });

  console.log(`[agent] registering with license at ${url}...`);

  // Node 18+ 自带 global fetch；pkg 打包也支持
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    console.error('[agent] register network error:', err);
    return null;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let parsed: { code?: string; message?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // ignore parse error
    }
    console.error(
      `[agent] License 注册失败 [${resp.status}] ${parsed.code || ''}: ${
        parsed.message || text
      }`
    );
    return null;
  }

  const data = (await resp.json()) as {
    ok: boolean;
    ws_token?: string;
    registered_machine_id?: string;
    tier?: string;
    max_machines?: number;
  };
  if (!data.ok || !data.ws_token) {
    console.error('[agent] register 响应异常:', data);
    return null;
  }
  console.log(
    `[agent] License 注册成功 — tier=${data.tier} 装机数上限=${data.max_machines}`
  );
  return {
    wsToken: data.ws_token,
    machineId: data.registered_machine_id || machineId,
    tier: data.tier,
    maxMachines: data.max_machines,
  };
}

function connect(cfg: AgentConfig): void {
  const url = `${cfg.apiUrl}?token=${encodeURIComponent(cfg.licenseKey)}`;
  console.log(`[agent] connecting to ${cfg.apiUrl}...`);
  updateTrayStatus('connecting');
  const ws = new WebSocket(url);

  let heartbeatTimer: NodeJS.Timeout | null = null;

  ws.on('open', () => {
    console.log(`[agent] connected as ${cfg.agentId}`);
    backoff = 1000;
    updateTrayStatus('online');
    ws.send(
      JSON.stringify(
        makeMsg('hello', {
          agentId: cfg.agentId,
          version: VERSION,
          capabilities: getCapabilities(),
        }),
      ),
    );
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify(
            makeMsg('heartbeat', {
              uptime: Date.now() - startTime,
              busy: false,
            }),
          ),
        );
      }
    }, 15000);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`[agent] received:`, msg.type, msg.taskId || '');
      const emit = (m: unknown) => ws.send(JSON.stringify(m));

      if (msg.type === 'publish_request') {
        const platform = msg.payload?.platform;
        if (platform === 'wechat') {
          await handleWechatPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'douyin') {
          await handleDouyinPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'kuaishou') {
          await handleKuaishouPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'xhs' || platform === 'xiaohongshu') {
          await handleXiaohongshuPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'toutiao') {
          await handleToutiaoPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'weibo') {
          await handleWeiboPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'shipinhao') {
          await handleShipinhaoPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else if (platform === 'zhihu') {
          await handleZhihuPublish(msg.taskId, msg.payload.content, emit, makeMsg);
        } else {
          console.warn('[agent] unsupported platform:', platform);
        }
      }
    } catch (err) {
      console.warn('[agent] invalid message:', err);
    }
  });

  ws.on('close', (code) => {
    console.log(`[agent] closed: ${code}, reconnecting in ${backoff}ms`);
    updateTrayStatus('offline');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(() => connect(cfg), backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  });

  ws.on('error', (err) => {
    console.warn('[agent] error:', err.message);
  });
}

// ---------- 入口 ----------

// 兜底：systray helper 子进程偶尔 EACCES / spawn 失败，
// 这类错误不应让主 ws 客户端 crash
process.on('unhandledRejection', (reason) => {
  console.warn('[agent] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.warn('[agent] uncaughtException:', err);
});

async function main(): Promise<void> {
  const cfg = loadOrInitConfig();
  console.log(`[agent] starting agent ${cfg.agentId} (v${VERSION})`);

  // v1.2 Day 1-2: License 注册流程
  //   - 旧 v1.1 config 已有连上的 ws，没 wsToken 也能跑（兼容路径）：
  //     如果环境变量 ZENITHJOY_REQUIRE_LICENSE_REGISTER=1 才强制 register
  //   - 新装 Agent（config 没 wsToken）：尝试 register，失败就用旧路径继续（不阻塞）
  //   - 已 register 过：跳过
  const requireRegister = process.env.ZENITHJOY_REQUIRE_LICENSE_REGISTER === '1';
  if (!cfg.wsToken) {
    const result = await registerWithLicense(cfg);
    if (result) {
      cfg.wsToken = result.wsToken;
      cfg.machineId = result.machineId;
      cfg.tier = result.tier;
      cfg.maxMachines = result.maxMachines;
      writeConfig(cfg);
    } else if (requireRegister) {
      console.error(
        '[agent] License 注册失败且 ZENITHJOY_REQUIRE_LICENSE_REGISTER=1 — 退出。'
      );
      process.exit(3);
    } else {
      console.warn(
        '[agent] License 注册失败 — 走 v1.1 兼容路径继续连 ws（旧服务端会接受）。'
      );
    }
  } else {
    console.log('[agent] 已注册过，跳过 license register。');
  }

  // 启动系统托盘
  try {
    startTray({
      version: VERSION,
      agentId: cfg.agentId,
      onRestart: () => {
        console.log('[agent] tray: restart 请求');
        // 简单做法：退出进程，让外部 supervisor 重启；
        // 没 supervisor 时客户双击 .exe 也能再起。
        process.exit(0);
      },
      onQuit: () => {
        console.log('[agent] tray: quit');
        destroyTray();
        process.exit(0);
      },
    });
  } catch (err) {
    console.warn('[agent] tray 启动失败（headless 模式继续）:', err);
  }

  connect(cfg);
}

main().catch((err) => {
  console.error('[agent] main() 异常退出:', err);
  process.exit(1);
});
