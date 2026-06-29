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
import { startTray, updateTrayStatus, updateTrayModules, showModuleError, destroyTray } from './tray';
// Walking Skeleton #1 — HTTP heartbeat 链路（与上面 WS 链路并存）
import {
  HeartbeatLoop,
  type HeartbeatTask,
  type HeartbeatResponse,
} from './handlers/heartbeat-loop';
// Sprint 06081700 — Core 模块管理器（下载/解压/preflight/fork）。
// Line 特有逻辑（wechat-rpa / preflight）下沉到按需下载的 Line 模块包，core 不再直接引用。
import { ModuleManager } from './module-manager';
// Sprint 06222100 — 核心运行时本体自升级（下载新核心包→解压→写 .active-core 指针→优雅退出）。
import { CoreUpgrader } from './core-upgrader';
// Sprint cp-06262240 — 任务观测上报：把 handler 开始/失败/成功接进 reportEvent 管子
import {
  reportTaskStart,
  reportTaskFail,
  reportTaskOk,
} from './shared/task-event-reporter';
import type { EventReporterConfig } from './shared/event-reporter';
import { handleQrBindDouyin } from './handlers/qr-bind-douyin';
// Path 2 Sprint B-1 — burner 小号绑定 handler（独立文件，与 Path 1 主号物理隔离）
import { handleQrBindDouyinBurner } from './handlers/qr-bind-douyin-burner';
import { writeEnvVar } from './utils/write-env-var';
// Path 2 — 抖音私信主动触达 handler（burner 号驱动真机 chrome 发私信）
import { handleDouyinDmOutreach } from './handlers/douyin-dm-outreach';
// 运营中枢 — 8 平台主号统一 qr-bind handler（Line 00 Session Health Medium）
import { handleQrBindOperator } from './handlers/qr-bind-operator';
import { createFolderWatchManager } from './handlers/folder-watch';
import { startHealthServer, setWsState } from './handlers/health-server';
import { startVideoPipelineLoop } from './handlers/video-pipeline';
import { searchDouyinVideosByKeyword } from './handlers/keyword-search-douyin';
import { ensureChromeHeadlessShell, ensureChromiumHeadful } from './handlers/ensure-chrome';
import { ensureFfmpeg } from './handlers/ensure-ffmpeg';
import { ensureHyperframes } from './handlers/ensure-hyperframes';
import { sanitizeApiBase } from './utils/sanitize-env';
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

// Sprint 06081700 — Core 模块管理器单例。
// 收到心跳 modules 响应后按需下载/解压/preflight/fork Line 模块；
// preflight 失败本地弹窗，模块子进程消息回流由 onModuleMessage 接住。
const moduleManager = new ModuleManager({
  // 自愈件1：line04（微信AI客服，宿主 listen_chat 长驻监听）必须保活——
  // 子进程退出/崩溃自动重启（指数退避 + 上限），不靠人手动 schtasks/重启。
  superviseLines: ['line04-wechat-cs'],
  onPreflightFail: (lineId, result) => {
    showModuleError(
      MODULE_LABELS[lineId] ?? lineId,
      result.fixGuide ?? result.reason ?? '环境预检未通过',
    );
  },
  // 自愈件1：连续崩溃超上限（修不动了）→ 本地告警 + 随心跳上报中台，让管理员看到。
  onModuleAlert: (lineId, reason) => {
    console.warn(`[module:${lineId}] ALERT`, reason);
    showModuleError(MODULE_LABELS[lineId] ?? lineId, reason);
  },
  onModuleMessage: (lineId, msg) => {
    console.log(`[module:${lineId}] →core`, msg);
  },
});

// Sprint 06222100 — 核心运行时本体自升级单例。
// 心跳收到 required_agent_version > 自身 VERSION 时：下载新核心包 → sha 校验 → 解压到
// extracted/zenithjoy-agent-v<ver> → 拷 .env/license/已下模块 → 写 .active-core 指针 →
// 优雅退出（由计划任务 ONLOGON 拉起的 start.bat 读指针拉起新核心）。
// 失败回滚到旧核心，绝不把客户机搞挂（与模块自升级同纪律）。
const coreUpgrader = new CoreUpgrader({ currentVersion: VERSION });

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

// 身份统一（cp-06270030）：事件上报 cfg 构造器 — agentId 统一用 register 返的 agentUuid，
//   而不是运行期 agent-env-xxx 文本，确保任务事件 agent_id 能匹配中台去重后的机器行。
//   cfg.agentUuid 缺失（老 cfg/register 失败）时退回 agentId（旁路观测，graceful）。
export function buildEventReporterConfig(
  cfg: AgentConfig,
  apiBase: string,
): EventReporterConfig {
  return {
    apiBase,
    license: cfg.licenseKey,
    agentId: cfg.agentUuid ?? cfg.agentId,
  };
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
  // FFmpeg and hyperframes are required for template rendering — await before accepting jobs.
  // Keeps non-blocking on failure so the agent can still handle other tasks.
  console.log('[agent] waiting for ffmpeg + hyperframes...');
  await Promise.all([
    ensureFfmpeg().catch((e) => console.warn('[ffmpeg] ensure failed:', e)),
    ensureHyperframes().catch((e) => console.warn('[hyperframes] ensure failed:', e)),
  ]);
  console.log('[agent] ffmpeg + hyperframes ready — starting loops');

  // Sprint 06081700 — 把 agentId / apiBase 交给模块管理器，激活模块时随 config 消息下发
  // 06230819 — 同时下发 machineId：line04 listen_chat 按它向中台拉「自己那份」每客服配置
  // 06231024 修：传【算好的】machineId，不是可能为空的 cfg.machineId。
  //   用缓存配置启动（命中 ws_token，跳过 registerWithLicense）的 agent，cfg.machineId 为空，
  //   旧代码把空值经 IPC 下发给模块 → listen_chat 拿不到 --machine-id → 回落 env。
  //   这里用与注册同款 `cfg.machineId || computeMachineId()`，保证 IPC 一定带上真实身份，
  //   真客户机无需手设 env ZENITHJOY_MACHINE_ID 即可激活每客服配置。
  moduleManager.setIdentity(
    cfg.agentUuid ?? cfg.agentId,
    deriveHttpApiBase(cfg) ?? undefined,
    cfg.machineId || computeMachineId(),
  );

  startWs1HeartbeatLoop(cfg);

  // Path 4 微信监听已下沉到 line04 模块（按需下载 + fork），core 不再直接启动。

  // 智能获客：关键词任务轮询 + 抖音视频搜索 + collect 任务轮询
  if (process.env.ZENITHJOY_DISABLE_ACQUISITION !== '1') {
    startAcquisitionKeywordLoop(cfg);
    startAcquisitionCollectLoop(cfg);
  }

  const _hbApiBase = sanitizeApiBase(process.env.ZENITHJOY_API_BASE);
  if (_hbApiBase) {
    startVideoPipelineLoop(_hbApiBase, cfg.licenseKey);
    console.log(`[agent] video-pipeline-loop started → ${_hbApiBase}/api/ai-video/jobs`);
  }

  // Sprint 2.1d: health-server :5201 让 supervisor 检测业务死循环
  startHealthServer(5201);
  console.log('[health] server listening :5201 /healthz');
}

function deriveHttpApiBase(cfg: AgentConfig): string | null {
  const explicit = process.env.ZENITHJOY_API_BASE;
  if (explicit) return sanitizeApiBase(explicit);
  // 从 wsApiUrl 推导：wss://api.../agent-ws → https://api...
  if (!cfg.apiUrl) return null;
  return cfg.apiUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/agent-ws\/?$/, '');
}

// ────── qr_bind_douyin task-ack ──────
// 没这个 → task 永远 pending → heartbeat 每 30s 重派 → Chrome 反复弹。

async function postQrBindDouyinAck(
  cfg: AgentConfig,
  taskId: string,
  result: string,
): Promise<void> {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.warn('[ws1:qr_bind_douyin] 无 apiBase，跳过 task-ack');
    return;
  }
  try {
    const resp = await fetch(`${apiBase}/api/agent/task-ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-license-key': cfg.licenseKey,
      },
      body: JSON.stringify({ task_id: taskId, result }),
    });
    console.log(`[ws1:qr_bind_douyin] task-ack HTTP ${resp.status} ${resp.ok ? 'OK' : 'FAIL'}`);
  } catch (err) {
    console.warn('[ws1:qr_bind_douyin] task-ack error:', (err as Error).message);
  }
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

// Path 2 — 私信触达结果回报中台（→ 写飞书 Lead 触达状态 / 单号停用不连坐）
async function postBurnerDmOutreachResult(
  cfg: AgentConfig,
  taskId: string,
  body: {
    agent_id?: string;
    account_label?: string;
    status?: string;
    error_code?: string;
    profile_url?: string;
    screenshot_path?: string;
  },
): Promise<void> {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.warn('[p2:dm_outreach_post] 无 apiBase，跳过 POST');
    return;
  }
  try {
    const resp = await fetch(`${apiBase}/api/agent/burner/dm-outreach-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, ...body }),
    });
    console.log(`[p2:dm_outreach_post] HTTP ${resp.status} ${resp.ok ? 'OK' : 'FAIL'}`);
  } catch (err) {
    console.warn('[p2:dm_outreach_post] error:', (err as Error).message);
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
    ], { windowsHide: true });
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

// lineId → 客户可读的中文模块名（弹窗用）
const MODULE_LABELS: Record<string, string> = {
  'line04-wechat-cs': '微信AI客服',
  'line01-publish': '智能发布',
  'line02-lead-gen': '智能获客',
  'line05-video': '视频剪辑',
};

// Sprint 06081700 — 心跳收到 modules 响应：交给 ModuleManager 同步
//   （对比本地版本 → 按需下载/解压 → preflight → 通过则 fork 激活，失败本地弹窗），
//   再把各模块 preflight 结果回写 loop（随下次心跳 module_status 上报）+ 刷新托盘激活态。
async function syncModulesFromHeartbeat(
  resp: HeartbeatResponse,
  loop: HeartbeatLoop,
): Promise<void> {
  const modules = resp.modules;
  if (!modules) return;
  await moduleManager.syncModules(modules);
  const report = moduleManager.getModuleStatusReport();
  if (Object.keys(report).length > 0) {
    loop.setModuleStatus(report);
  }
  updateTrayModules(buildTrayModules(modules));
}

// Sprint 06222100 — 心跳收到 required_agent_version：交给 CoreUpgrader 判断是否升级核心本体。
//   needsUpgrade=false → no-op；true → 下载新核心包→sha 校验→解压→写 .active-core 指针→优雅退出
//   （成功则本进程退出，由启动器拉起新核心）。任何失败回滚旧核心，绝不让 core 崩溃。
async function maybeUpgradeCore(resp: HeartbeatResponse): Promise<void> {
  const req = resp.required_agent_version;
  if (!req || !req.version) return;
  try {
    const r = await coreUpgrader.upgradeIfNeeded(req.version, {
      sha256: req.sha256,
      size: req.size,
    });
    if (r.upgraded) {
      console.log(`[core-upgrade] 核心已升级到 ${r.version}，等待启动器拉起新核心`);
    } else if (r.reason && r.reason !== 'up_to_date') {
      console.warn(`[core-upgrade] 未升级：${r.reason}`);
    }
  } catch (err) {
    console.warn('[core-upgrade] 升级流程异常（保留旧核心）：', err);
  }
}

// 把心跳 modules + ModuleManager 激活态合成托盘渲染数据（仅展示已购买/激活的 Line）
function buildTrayModules(
  modules: NonNullable<HeartbeatResponse['modules']>,
): Record<string, { label: string; running: boolean }> {
  const active = new Set(moduleManager.getActiveModules());
  const out: Record<string, { label: string; running: boolean }> = {};
  for (const [lineId, v] of Object.entries(modules)) {
    const status = typeof v === 'string' ? v : v?.status;
    if (status !== 'active') continue;
    out[lineId] = {
      label: MODULE_LABELS[lineId] ?? lineId,
      running: active.has(lineId),
    };
  }
  return out;
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

  // 去重锁：heartbeat 每 30s 重派 pending task，同一 task_id 并发派会开多个 Chrome 窗口
  const processingTasks = new Set<string>();

  // Sprint cp-06262240 — 观测上报 cfg（与下方 coreUpgrader.setReporter 同源）。
  // 身份统一（cp-06270030）：agentId 用 register 返的 agentUuid，匹配中台去重机器行。
  const eventCfg: EventReporterConfig = buildEventReporterConfig(cfg, apiBase);

  const onTask = async (task: HeartbeatTask): Promise<void> => {
    if (processingTasks.has(task.task_id)) {
      console.log(`[ws1] skip duplicate task_id=${task.task_id} (already processing)`);
      return;
    }
    processingTasks.add(task.task_id);
    console.log('[ws1] task:', task.platform, task.task_id);
    // 观测：任务开始（info）。account_label 尽力从 payload 取。
    const acctLabel = (task.payload as { account_label?: string } | undefined)?.account_label;
    void reportTaskStart(eventCfg, {
      platform: task.platform,
      taskId: task.task_id,
      accountLabel: acctLabel,
    });
    try {
      if (task.platform === 'qr_bind_douyin') {
        const res = await handleQrBindDouyin(
          task.payload as { account_label?: string },
        );
        console.log('[ws1:qr_bind_douyin] result:', res);
        if (res.ok) {
          void reportTaskOk(eventCfg, { platform: task.platform, taskId: task.task_id, accountLabel: acctLabel });
        } else {
          void reportTaskFail(eventCfg, { platform: task.platform, taskId: task.task_id, error: res.error ?? 'unknown', accountLabel: acctLabel });
        }
        const ackResult = res.qr_login ?? (res.ok ? 'success' : (res.error ? `failed:${res.error}` : 'failed'));
        await postQrBindDouyinAck(cfg, task.task_id, ackResult);
      } else if (
        task.platform === 'qr_bind_douyin_burner' ||
        task.platform === 'qr_bind/douyin_burner'
      ) {
        // Path 2 Sprint B-1 — 抖音小号扫码绑定（与主号 qr_bind_douyin 物理隔离）
        const res = await handleQrBindDouyinBurner(
          task.payload as { account_label: string },
        );
        console.log('[p2-b1:qr_bind_douyin_burner] result:', res);
        // 观测：qr-bind 失败必把 handler 的 error 原样上报中台（playwright 未安装 /
        // Edge 启动失败 / profile 锁等）—— 本 sprint 核心目的。
        if (res.ok) {
          // 绑定成功：把 burner Chrome profile 路径写入 .env，让 keyword-search 走有头模式
          const accountLabel = (task.payload as { account_label?: string }).account_label ?? 'default';
          const burnerDataDir = process.platform === 'win32'
            ? path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel)
            : path.join(os.homedir(), '.zenithjoy-agent', 'chrome-profile', 'douyin-burner', accountLabel);
          try {
            writeEnvVar(path.join(path.dirname(process.execPath), '.env'), 'ZJ_MAIN_DATA_DIR', burnerDataDir);
            process.env.ZJ_MAIN_DATA_DIR = burnerDataDir;
            console.log(`[p2-b1:qr_bind] 已写 ZJ_MAIN_DATA_DIR=${burnerDataDir}`);
          } catch (e) {
            console.warn('[p2-b1:qr_bind] 写 ZJ_MAIN_DATA_DIR 失败:', e);
          }
          void reportTaskOk(eventCfg, { platform: task.platform, taskId: task.task_id, accountLabel });
        } else {
          void reportTaskFail(eventCfg, { platform: task.platform, taskId: task.task_id, error: res.error ?? 'unknown', accountLabel: (task.payload as { account_label?: string }).account_label });
        }
        // ✨ 真回报 backend (修 burner 'chrome 一直闪' loop bug):
        // 没这一步 task 永远 'pending' → 每 30s heartbeat 重派 → 重启 chrome 撞 lock。
        await postBurnerQrBindResult(cfg, task.task_id, {
          agent_id: cfg.agentUuid,
          qr_login: res.qr_login || (res.ok ? 'success' : 'failed'),
          cookie_local_path: res.cookie_local_path,
          account_nickname: res.account_nickname,
        });
      } else if (
        task.platform === 'qr_bind/douyin' ||
        task.platform === 'qr_bind/kuaishou' ||
        task.platform === 'qr_bind/xiaohongshu' ||
        task.platform === 'qr_bind/shipinhao' ||
        task.platform === 'qr_bind/toutiao' ||
        task.platform === 'qr_bind/weibo' ||
        task.platform === 'qr_bind/zhihu' ||
        task.platform === 'qr_bind/gongzhonghao'
      ) {
        // 运营中枢 8 平台主号扫码绑定（Line 00 Session Health Medium）
        const platformName = task.platform.replace('qr_bind/', '');
        const res = await handleQrBindOperator({ platform: platformName, ...task.payload as Record<string, unknown> });
        console.log(`[ws1:${task.platform}] result: ok=${res.ok}`);
        if (res.ok) {
          void reportTaskOk(eventCfg, { platform: task.platform, taskId: task.task_id, accountLabel: acctLabel });
        } else {
          void reportTaskFail(eventCfg, { platform: task.platform, taskId: task.task_id, error: res.error ?? 'unknown', accountLabel: acctLabel });
        }
        // task-ack：没这一步 task 永远 queued → 每次心跳重派 → Chrome 反复弹
        await postQrBindDouyinAck(cfg, task.task_id, res.ok ? 'success' : `failed:${res.error ?? 'unknown'}`);
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
          await postQrBindDouyinAck(cfg, task.task_id, 'success');
        } else {
          console.warn('[ws1:folder_bind] missing local_path');
          await postQrBindDouyinAck(cfg, task.task_id, 'failed:missing_local_path');
        }
      } else if (
        task.platform === 'douyin' &&
        (task.payload as { task_type?: string }).task_type === 'dm_outreach'
      ) {
        // Path 2 — 抖音私信主动触达（burner 号驱动真机 chrome 发私信）
        // platform='douyin' 但 payload.task_type='dm_outreach'，须在 folder-publish 'douyin' 分支前判定。
        const p = task.payload as {
          account_label?: string;
          profile_url?: string;
          message?: string;
        };
        const res = await handleDouyinDmOutreach({
          profile_url: p.profile_url || '',
          message: p.message || '',
          account_label: p.account_label || '',
        });
        console.log('[p2:dm_outreach] result:', res.status, res.ok);
        if (res.ok) {
          void reportTaskOk(eventCfg, { platform: task.platform, taskId: task.task_id, accountLabel: p.account_label });
        } else {
          void reportTaskFail(eventCfg, { platform: task.platform, taskId: task.task_id, error: res.error_code ?? res.status ?? 'unknown', accountLabel: p.account_label });
        }
        await postBurnerDmOutreachResult(cfg, task.task_id, {
          agent_id: cfg.agentUuid,
          account_label: p.account_label,
          status: res.status,
          error_code: res.error_code,
          profile_url: p.profile_url,
        });
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
          { apiBase, licenseKey: cfg.licenseKey },
        );
        console.log('[ws1:douyin] result:', res.status);
      } else if (
        task.platform === 'wechat_qr_bind' ||
        task.platform === 'wechat_moments_send' ||
        task.platform === 'wechat_private_chat_send'
      ) {
        // Sprint 06081700 — Path 4 微信任务转发给已激活的 line04 模块子进程处理。
        // 模块未激活（未购买/preflight 未过）时 forwardMessage 仅记录日志，不报错。
        moduleManager.forwardMessage('line04-wechat-cs', {
          type: 'incoming_message',
          data: { taskType: task.platform, task_id: task.task_id, payload: task.payload },
        });
        console.log('[p4:wechat] forwarded to line04 module:', task.platform);
      } else {
        console.warn('[ws1] unknown task platform:', task.platform);
      }
    } catch (err) {
      console.warn('[ws1] task handler threw:', err);
      // 观测：handler 抛异常也上报失败（error 文本原样进 message）
      void reportTaskFail(eventCfg, {
        platform: task.platform,
        taskId: task.task_id,
        error: err instanceof Error ? err.message : String(err),
        accountLabel: acctLabel,
      });
    } finally {
      processingTasks.delete(task.task_id);
    }
  };

  // Sprint cp-06261900 — 把观测上报配置回填给核心自升级单例，
  // 升级各阶段（download/verify/extract/activate/done）+ 错误会 POST /api/agent/events（失败静默吞）。
  coreUpgrader.setReporter({ apiBase, license: cfg.licenseKey, agentId: cfg.agentUuid ?? cfg.agentId });

  const loop = new HeartbeatLoop({
    apiBase,
    license: cfg.licenseKey,
    version: VERSION,
    hostname: os.hostname() || safeHostnameSlug(),
    // 身份统一（cp-06270030）：心跳带 register 返的 UUID → 中台复用同一行，不裂身份
    agentUuid: cfg.agentUuid,
    osType: process.platform,
    intervalMs: 30_000,
    onTask,
    onHeartbeat: (resp) => {
      // 核心自升级优先：若中台要求更高核心版本，下载自换重启（成功则本进程已退出）。
      // 放在 syncModules 之前——核心是承载模块的底座，先把底座升到位。
      void maybeUpgradeCore(resp);
      if (resp.modules) {
        void syncModulesFromHeartbeat(resp, loop);
      }
    },
    onError: (err) => console.warn('[ws1:heartbeat] error:', err),
  });
  loop.start();
  console.log(`[ws1] heartbeat-loop started → ${apiBase}/api/agent/heartbeat`);

  // v1.1.34: 本地发现服务器 — Dashboard 访问 localhost:58432/agent-id 拿本机 UUID，精准派 trigger-bind
  startLocalDiscoveryServer(loop);

  // Chrome is non-critical for video pipeline startup — non-blocking
  ensureChromeHeadlessShell().catch((e) => console.warn('[chrome] ensure failed:', e));
  // Full headful Chromium for QR-bind (downloads if no system Chrome installed)
  ensureChromiumHeadful().catch((e) => console.warn('[chrome-headful] ensure failed:', e));
}


// ────── v1.1.34: 本地发现服务器 ──────
// Dashboard 调 GET localhost:58432/agent-id 拿本机 agent UUID，
// 再把 agent_id 带给 trigger-bind，避免多机环境派到错误机器。
function startLocalDiscoveryServer(loop: HeartbeatLoop): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('node:http') as typeof import('node:http');
  const port = parseInt(process.env.ZENITHJOY_LOCAL_PORT || '58432', 10);

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/agent-id') {
      const agentId = loop.getAgentId();
      if (agentId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agent_id: agentId }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'heartbeat not received yet' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[local-discovery] port ${port} already in use — skipping`);
    } else {
      console.warn('[local-discovery] server error:', err.message);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[local-discovery] listening on http://127.0.0.1:${port}/agent-id`);
  });
}

// ────── 智能获客：关键词任务轮询 ──────
function startAcquisitionKeywordLoop(cfg: AgentConfig): void {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.log('[acquisition] 无法推导 apiBase，跳过 keyword 轮询');
    return;
  }

  const POLL_INTERVAL_MS = 30_000;

  // Sprint cp-06262240 — 观测上报 cfg（与 ws1 heartbeat 同源）。
  // 身份统一（cp-06270030）：agentId 用 register 返的 agentUuid。
  const eventCfg: EventReporterConfig = buildEventReporterConfig(cfg, apiBase);

  async function pollAndProcess(): Promise<void> {
    try {
      const resp = await fetch(`${apiBase}/api/acquisition/pending-keyword-tasks`);
      if (!resp.ok) return;
      const data = await resp.json() as { tasks?: Array<{ task_id: string; keyword: string; keywords: string[] }>; total?: number };
      const tasks = data.tasks ?? [];
      if (tasks.length === 0) return;

      console.log(`[acquisition] 发现 ${tasks.length} 个关键词任务`);

      for (const task of tasks) {
        const { task_id, keywords } = task;
        const allVideoUrls: string[] = [];

        void reportTaskStart(eventCfg, { platform: 'keyword_search_douyin', taskId: task_id });

        // 逐词搜索热门视频
        for (const kw of keywords) {
          const result = await searchDouyinVideosByKeyword(kw);
          if (result.ok && result.video_urls.length > 0) {
            allVideoUrls.push(...result.video_urls);
          } else if (!result.ok) {
            void reportTaskFail(eventCfg, {
              platform: 'keyword_search_douyin',
              taskId: task_id,
              error: `关键词「${kw}」搜索失败: ${(result as { error?: string }).error ?? 'unknown'}`,
            });
          }
        }

        if (allVideoUrls.length > 0) {
          // 上报视频搜索结果
          await fetch(`${apiBase}/api/acquisition/video-search-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keyword_task_id: task_id,
              keyword: task.keyword,
              videos: allVideoUrls.map((url) => ({ video_url: url })),
            }),
          }).catch((e) => console.warn('[acquisition] video-search-result POST failed:', e.message));

          // 逐视频抓评论（复用 burner 评论抓取逻辑）
          for (const videoUrl of allVideoUrls.slice(0, 10)) {
            const crawlResult = await handleCrawlCommentsBurner({
              account_label: 'main',
              video_url: videoUrl,
              max_comments: 50,
            });
            if (crawlResult.ok && Array.isArray(crawlResult.comments) && crawlResult.comments.length > 0) {
              await fetch(`${apiBase}/api/acquisition/comment-score-result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  keyword_task_id: task_id,
                  video_url: videoUrl,
                  comments: crawlResult.comments,
                }),
              }).catch((e) => console.warn('[acquisition] comment-score-result POST failed:', e.message));
            }
          }
        }

        // 标记任务完成
        await fetch(`${apiBase}/api/acquisition/video-search-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword_task_id: task_id,
            keyword: task.keyword,
            videos: [],
          }),
        }).catch(() => null);
      }
    } catch (err) {
      console.warn('[acquisition] poll error:', (err as Error).message);
    }
  }

  // 首次立即执行，然后每 30 秒轮询
  pollAndProcess();
  const timer = setInterval(pollAndProcess, POLL_INTERVAL_MS);
  console.log(`[acquisition] keyword 轮询已启动，间隔 ${POLL_INTERVAL_MS / 1000}s`);
  // 防止 timer 阻止进程退出
  if (timer.unref) timer.unref();
}

// ────── 智能获客：collect 任务轮询（来自 /collect/start 写入的 acquisition_collect_tasks）──────
function startAcquisitionCollectLoop(cfg: AgentConfig): void {
  const apiBase = deriveHttpApiBase(cfg);
  if (!apiBase) {
    console.log('[acquisition] 无法推导 apiBase，跳过 collect 轮询');
    return;
  }

  const POLL_INTERVAL_MS = 30_000;

  async function pollAndProcess(): Promise<void> {
    try {
      const resp = await fetch(`${apiBase}/api/acquisition/pending-collect-tasks`);
      if (!resp.ok) return;
      const data = await resp.json() as {
        tasks?: Array<{ task_id: string; tenant_id: string; keywords: string[] }>;
        total?: number;
      };
      const tasks = data.tasks ?? [];
      if (tasks.length === 0) return;

      console.log(`[acquisition] 发现 ${tasks.length} 个 collect 采集任务`);

      for (const task of tasks) {
        const { task_id, keywords } = task;
        const allVideoIds: string[] = [];

        for (const kw of keywords) {
          const result = await searchDouyinVideosByKeyword(kw);
          if (result.ok && result.video_urls.length > 0) {
            for (const url of result.video_urls) {
              const m = url.match(/\/video\/(\d+)/);
              if (m) allVideoIds.push(m[1]);
            }
          } else if (!result.ok) {
            console.warn(
              `[acquisition] collect 关键词「${kw}」失败: ${(result as { error?: string }).error ?? 'unknown'}`,
            );
          }
        }

        // 每个视频上报一次（commenters 留空，此阶段只需视频 ID 落库）
        for (const videoId of allVideoIds.slice(0, 10)) {
          await fetch(`${apiBase}/api/acquisition/collect/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id, video_id: videoId, commenters: [], terminal: false }),
          }).catch((e) => console.warn('[acquisition] collect/report POST failed:', e.message));
        }

        // 终态回报
        const finalVideoId = allVideoIds[0] ?? 'no_videos';
        await fetch(`${apiBase}/api/acquisition/collect/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id, video_id: finalVideoId, commenters: [], terminal: true }),
        }).catch(() => null);
      }
    } catch (err) {
      console.warn('[acquisition] collect poll error:', (err as Error).message);
    }
  }

  pollAndProcess();
  const timer = setInterval(pollAndProcess, POLL_INTERVAL_MS);
  console.log(`[acquisition] collect 轮询已启动，间隔 ${POLL_INTERVAL_MS / 1000}s`);
  if (timer.unref) timer.unref();
}

// H-2 Bug 9: 仅作为入口脚本时运行 main()。test import 不触发 main()，让 buildHelloPayload 等纯函数可单测。
if (require.main === module) {
  // --print-version / --version：打印版本后立即退出 0，不启守护进程。
  // 这条轻量路径同时是 CI 的 exe overlay 完整性探针：pkg 打的 exe 跑这个会真去读
  // 追加在 exe 末尾的 snapshot overlay（require('../package.json')）。overlay 被截断时
  // 这里会抛 `Pkg: Error reading from file` → CI gate 红，钉死 2.0.25 那类打包回归。
  if (process.argv.includes('--print-version') || process.argv.includes('--version')) {
    console.log(VERSION);
    process.exit(0);
  }
  main().catch((err) => {
    console.error('[agent] main() 异常退出:', err);
    process.exit(1);
  });
}
