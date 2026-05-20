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
import { loadOrInitConfig as loadOrInitConfigFromLoader, type AgentConfig as LoaderAgentConfig } from './config-loader';
import { handleWechatPublish } from './handlers/wechat-publish';
import { handleDouyinPublish, handleDouyinPublishTask, type DouyinPublishType } from './handlers/douyin-publish';
import { handleKuaishouPublish } from './handlers/kuaishou-publish';
import { handleXiaohongshuPublish } from './handlers/xiaohongshu-publish';
import { handleToutiaoPublish } from './handlers/toutiao-publish';
import { handleWeiboPublish } from './handlers/weibo-publish';
import { handleShipinhaoPublish } from './handlers/shipinhao-publish';
import { handleZhihuPublish } from './handlers/zhihu-publish';
import { startTray, updateTrayStatus, destroyTray } from './tray';
// Walking Skeleton #1 — HTTP heartbeat 链路（与上面 WS 链路并存）
import { HeartbeatLoop, type HeartbeatTask } from './handlers/heartbeat-loop';
import { handleQrBindDouyin } from './handlers/qr-bind-douyin';
// Path 2 Sprint B-1 — burner 小号绑定 handler（独立文件，与 Path 1 主号物理隔离）
import { handleQrBindDouyinBurner } from './handlers/qr-bind-douyin-burner';
// Path 4 Sprint 1 WS1 — wechat-rpa handler (Python dryrun stub, 真 wechat_bot.py 在 WS3/4 接)
import { handleWechatRpa, type WechatRpaTask } from './handlers/wechat-rpa';
import { createFolderWatchManager } from './handlers/folder-watch';
import { startHealthServer, setWsState } from './handlers/health-server';
import { startVideoPipelineLoop } from './handlers/video-pipeline';
import { ensureChromeHeadlessShell } from './handlers/ensure-chrome';
import { ensureFfmpeg } from './handlers/ensure-ffmpeg';
import { ensureHyperframes } from './handlers/ensure-hyperframes';
import dns from 'node:dns';

// Windows 防火墙封锁 IPv6（EACCES on 2606:4700::）→ 强制 Node.js 优先解析 IPv4
dns.setDefaultResultOrder('ipv4first');

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
  agentUuid?: string; // H-2 Bug 9: register 返的 agents.id (UUID), WS hello 携带复用 row
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
  // Sprint 2.1f Fix 6: 优先命令行参数（--license=ZJ-XXXX，首次启动），
  // 其次 env var ZENITHJOY_LICENSE（start.bat 注入），
  // 再其次 %APPDATA%/zenithjoy-agent/config.json（旧 v1.0.0 兼容）
  const cliLicense = parseLicenseFromArgs();
  if (cliLicense) {
    // 命令行参数路径 — 写入 config.json 持久化，让后续启动不需再传 --license
    const existing = readConfig();
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

  // 没有命令行参数 → 走 envOrConfig loader (Fix 6)
  try {
    const cfg = loadOrInitConfigFromLoader() as AgentConfig;
    // 若 env 路径拿到的是轻量 config（无 agentId），补全字段
    if (!cfg.agentId) {
      cfg.agentId = `agent-${safeHostnameSlug()}-${Date.now().toString(36)}`;
    }
    return cfg;
  } catch (err) {
    console.error('[agent] 未找到 license。', (err as Error).message);
    console.error(`[agent] 配置文件位置：${CONFIG_FILE}`);
    process.exit(2);
  }
}

// ---------- WebSocket 业务核心 ----------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION: string = (require('../package.json') as { version: string }).version;

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
  agentUuid?: string; // H-2 Bug 9
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
    agent_id?: string; // H-2 Bug 9: backend 返的 agents.id (UUID), Agent 存 cfg.agentUuid
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
    agentUuid: data.agent_id, // H-2 Bug 9
  };
}

// H-2 Bug 9: WS hello payload 构造器 — agentUuid optional 字段向后兼容
//   - cfg.agentUuid set (新 Agent v1.0.1+ register 后)：hello 带 agentUuid → backend UPDATE 复用 row
//   - cfg.agentUuid undefined (老 cfg / register 失败)：hello 不含 agentUuid → backend 走 findOrCreateAgentUuid 老 path
export function buildHelloPayload(cfg: AgentConfig): {
  agentId: string;
  agentUuid?: string;
  version: string;
  capabilities: string[];
} {
  const payload: { agentId: string; agentUuid?: string; version: string; capabilities: string[] } = {
    agentId: cfg.agentId,
    version: VERSION,
    capabilities: getCapabilities(),
  };
  if (cfg.agentUuid) {
    payload.agentUuid = cfg.agentUuid;
  }
  return payload;
}

function connect(cfg: AgentConfig): void {
  const url = `${cfg.apiUrl}?token=${encodeURIComponent(cfg.licenseKey)}`;
  console.log(`[agent] connecting to ${cfg.apiUrl}...`);
  updateTrayStatus('connecting');
  const ws = new WebSocket(url);
  setWsState('connecting');

  let heartbeatTimer: NodeJS.Timeout | null = null;

  ws.on('open', () => {
    setWsState('open');
    console.log(`[agent] connected as ${cfg.agentId}`);
    backoff = 1000;
    updateTrayStatus('online');
    ws.send(JSON.stringify(makeMsg('hello', buildHelloPayload(cfg))));
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
    setWsState('closed');
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
      cfg.agentUuid = result.agentUuid; // H-2 Bug 9
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

  // Walking Skeleton #1 — 启动 HTTP heartbeat-loop（opt-in，由 ZENITHJOY_API_BASE 触发）
  //   - apiBase 例：https://api.zenithjoy.com
  //   - 不影响上面 WS 链路；两条链路共存（WS 是旧 v0.3 协议，heartbeat 是 ws1 协议）
  //   - folder-watch / qr-bind 状态在 heartbeat-loop 进程内维护
  startWs1HeartbeatLoop(cfg);

  // Sprint 2.1d: health-server :5201 让 supervisor 检测业务死循环
  startHealthServer(5201);
  console.log('[health] server listening :5201 /healthz');
}

function deriveHttpApiBase(cfg: AgentConfig): string | null {
  const explicit = process.env.ZENITHJOY_API_BASE;
  if (explicit) return explicit.replace(/\/+$/, '');
  // 从 wsApiUrl 推导：wss://api.../agent-ws → https://api...
  if (!cfg.apiUrl) return null;
  return cfg.apiUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/agent-ws\/?$/, '');
}

// ────── B-1 burner POST result helpers ──────
// 没这俩 → task 永远 pending → heartbeat 重派 → chrome 重启撞 lock 一直闪。

async function postBurnerQrBindResult(
  cfg: AgentConfig,
  taskId: string,
  body: { agent_id?: string; qr_login?: string; cookie_local_path?: string; account_nickname?: string },
): Promise<void> {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.warn('[p2-b1:qr_bind_post] 无 apiBase，跳过 POST');
    return;
  }
  try {
    const resp = await fetch(`${apiBase}/api/agent/burner/qr-bind-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, ...body }),
    });
    console.log(`[p2-b1:qr_bind_post] HTTP ${resp.status} ${resp.ok ? 'OK' : 'FAIL'}`);
  } catch (err) {
    console.warn('[p2-b1:qr_bind_post] error:', (err as Error).message);
  }
}

async function postBurnerCrawlResult(
  cfg: AgentConfig,
  taskId: string,
  body: { ok?: boolean; comments?: unknown[]; video_url?: string; error_code?: string; error?: string },
): Promise<void> {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.warn('[p2-b1:crawl_post] 无 apiBase，跳过 POST');
    return;
  }
  try {
    const resp = await fetch(`${apiBase}/api/agent/burner/crawl-comments-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, ...body }),
    });
    console.log(`[p2-b1:crawl_post] HTTP ${resp.status} ${resp.ok ? 'OK' : 'FAIL'}`);
  } catch (err) {
    console.warn('[p2-b1:crawl_post] error:', (err as Error).message);
  }
}

async function handleCrawlCommentsBurner(payload: {
  account_label: string;
  video_url: string;
  max_comments?: number;
}): Promise<{ ok: boolean; comments?: unknown[]; video_url?: string; error_code?: string; error?: string }> {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const os = await import('node:os');
  const accountLabel = payload.account_label;
  const videoUrl = payload.video_url;
  const maxComments = payload.max_comments ?? 5;
  if (!accountLabel || !videoUrl) {
    return { ok: false, error: 'missing account_label or video_url' };
  }
  // burner profile path 跟 qr-bind handler 一致
  const userDataDir =
    process.platform === 'win32'
      ? path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel)
      : path.join(os.homedir(), '.zenithjoy-agent', 'chrome-profile', 'douyin-burner', accountLabel);
  // crawl 脚本 (Sprint B-1 写的)
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'douyin-comment-crawl.cjs');
  return new Promise((resolve) => {
    const proc = spawn('node', [
      scriptPath,
      `--user-data-dir=${userDataDir}`,
      `--video-url=${videoUrl}`,
      `--max-comments=${maxComments}`,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (stderr) console.log('[crawl stderr]', stderr);
      try {
        // 取最后一行 JSON (crawl 脚本可能有 stderr log + stdout 是最后 JSON)
        const lines = stdout.trim().split('\n').filter(Boolean);
        const last = lines[lines.length - 1] || '{}';
        const parsed = JSON.parse(last);
        resolve(parsed);
      } catch (err) {
        resolve({
          ok: false,
          error: `parse fail: ${(err as Error).message}; stdout=${stdout.slice(-200)}; code=${code}`,
        });
      }
    });
  });
}

function startWs1HeartbeatLoop(cfg: AgentConfig): void {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.log('[ws1] 无法推导 HTTP apiBase，跳过 heartbeat-loop');
    return;
  }
  if (process.env.ZENITHJOY_DISABLE_WS1 === '1') {
    console.log('[ws1] 已通过 ZENITHJOY_DISABLE_WS1=1 关闭');
    return;
  }

  const folderWatch = createFolderWatchManager({
    onChange: (file) => console.log('[ws1:folder-watch] change:', file),
  });

  const onTask = async (task: HeartbeatTask): Promise<void> => {
    console.log('[ws1] task:', task.platform, task.task_id);
    try {
      if (task.platform === 'qr_bind_douyin') {
        const res = await handleQrBindDouyin(
          task.payload as { account_label?: string },
        );
        console.log('[ws1:qr_bind_douyin] result:', res);
      } else if (
        task.platform === 'qr_bind_douyin_burner' ||
        task.platform === 'qr_bind/douyin_burner'
      ) {
        // Path 2 Sprint B-1 — 抖音小号扫码绑定（与主号 qr_bind_douyin 物理隔离）
        const res = await handleQrBindDouyinBurner(
          task.payload as { account_label: string },
        );
        console.log('[p2-b1:qr_bind_douyin_burner] result:', res);
        // ✨ 真回报 backend (修 burner 'chrome 一直闪' loop bug):
        // 没这一步 task 永远 'pending' → 每 30s heartbeat 重派 → 重启 chrome 撞 lock。
        await postBurnerQrBindResult(cfg, task.task_id, {
          agent_id: cfg.agentUuid,
          qr_login: res.qr_login || (res.ok ? 'success' : 'failed'),
          cookie_local_path: res.cookie_local_path,
          account_nickname: res.account_nickname,
        });
      } else if (
        task.platform === 'crawl_comments_douyin_burner' ||
        task.platform === 'crawl_comments/douyin_burner'
      ) {
        // Path 2 Sprint B-1 — 评论抓取（用 burner cookies 真去抖音抓评论）
        const res = await handleCrawlCommentsBurner(
          task.payload as { account_label: string; video_url: string; max_comments?: number },
        );
        console.log('[p2-b1:crawl_comments_douyin_burner] result:', res);
        // 真回报 backend → 写飞书 Lead 表
        await postBurnerCrawlResult(cfg, task.task_id, res);
      } else if (task.platform === 'folder_bind') {
        const localPath = (task.payload as { local_path?: string }).local_path;
        if (localPath) {
          folderWatch.bind(localPath);
          console.log('[ws1:folder_bind] bound:', folderWatch.getBoundPath());
        } else {
          console.warn('[ws1:folder_bind] missing local_path');
        }
      } else if (task.platform === 'douyin') {
        const payload = task.payload as { folder_path?: string };
        const folderPath = payload.folder_path || folderWatch.getBoundPath();
        if (!folderPath) {
          console.warn('[ws1:douyin] no folder_path; agent not bound yet');
          return;
        }
        const res = await handleDouyinPublishTask(
          {
            task_id: task.task_id,
            folder_path: folderPath,
            type: task.type as DouyinPublishType | undefined,
          },
          { apiBase },
        );
        console.log('[ws1:douyin] result:', res.status);
      } else if (
        task.platform === 'wechat_qr_bind' ||
        task.platform === 'wechat_moments_send' ||
        task.platform === 'wechat_private_chat_send'
      ) {
        // Path 4 Sprint 1 WS1 — wechat-rpa dispatch (Python dryrun stub)
        // 真 dispatch + 回报中台在 WS3/4 接入 (真 wechat_bot.py / wechat_rpa.py)
        const res = await handleWechatRpa({
          type: task.platform as WechatRpaTask['type'],
          payload: (task.payload as Record<string, unknown>) || {},
        });
        console.log('[p4-ws1:wechat-rpa]', task.platform, 'result:', res);
      } else {
        console.warn('[ws1] unknown task platform:', task.platform);
      }
    } catch (err) {
      console.warn('[ws1] task handler threw:', err);
    }
  };

  const loop = new HeartbeatLoop({
    apiBase,
    license: cfg.licenseKey,
    version: VERSION,
    hostname: os.hostname() || safeHostnameSlug(),
    intervalMs: 30_000,
    onTask,
    onError: (err) => console.warn('[ws1:heartbeat] error:', err),
  });
  loop.start();
  console.log(`[ws1] heartbeat-loop started → ${apiBase}/api/agent/heartbeat`);

  // Auto-install Chrome headless shell and hyperframes npm package (non-blocking)
  ensureChromeHeadlessShell().catch((e) => console.warn('[chrome] ensure failed:', e));
  ensureFfmpeg().catch((e) => console.warn('[ffmpeg] ensure failed:', e));
  ensureHyperframes().catch((e) => console.warn('[hyperframes] ensure failed:', e));

  startVideoPipelineLoop(apiBase, cfg.licenseKey);
  console.log(`[ws1] video-pipeline-loop started → ${apiBase}/api/ai-video/jobs`);
}

// H-2 Bug 9: 仅作为入口脚本时运行 main()。test import 不触发 main()，让 buildHelloPayload 等纯函数可单测。
if (require.main === module) {
  main().catch((err) => {
    console.error('[agent] main() 异常退出:', err);
    process.exit(1);
  });
}
