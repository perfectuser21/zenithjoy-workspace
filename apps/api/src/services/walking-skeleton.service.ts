/**
 * Walking Skeleton #1 业务服务
 *
 * 暴露给 routes 的几个函数：
 *  - validateLicense：心跳/folder/publish 端点共用的 license 校验
 *  - upsertAgentByHeartbeat：心跳进来时找/建 agent 记录
 *  - getQueuedTasks：拉一个 agent 的 pending publish_tasks
 *  - bindFolder：写 agent.bound_folder_path + 入队 folder_bind task
 *  - createPublishTask：入队 publish task
 *  - submitPublishReceipt：写 publish task 回执
 *  - getPublishTask：单条 task 查询
 *
 * 契约来源：/tmp/walking-skeleton-1-contract.md 第 2 节
 */

import crypto from 'node:crypto';
import pool from '../db/connection';
import { readInstallPackManifest } from './install-pack-manifest';

export interface LicenseRowMin {
  id: string;
  license_key: string;
  tenant_id: string | null;
  status: 'active' | 'expired' | 'revoked' | 'suspended';
  expires_at: string;
}

export interface AgentRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  hostname: string | null;
  version: string | null;
  license_id: string | null;
  bound_folder_path: string | null;
  last_heartbeat_at: string | null;
  status: string;
  last_seen: string | null;
}

export interface PublishTaskRow {
  id: string;
  agent_id: string;
  platform: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  type: 'video' | 'image' | 'article';
  folder_path: string | null;
  result: unknown | null;
  receipt_at: string | null;
  created_at: string;
  // B-1 Sprint burner / 后续 task type 通用 payload (account_label 等)
  payload: Record<string, unknown> | null;
}

/** 服务端下发：单个 Line 模块的激活态 + 要求版本 */
export interface ModuleDescriptor {
  status: 'active' | 'locked' | 'not_purchased';
  required_version: string;
}

/** 客户端上报：单个 Line 模块的 preflight 结果 */
export interface ModuleStatusEntry {
  ok: boolean;
  reason?: string;
}

export type ModuleStatusMap = Record<string, ModuleStatusEntry>;

/**
 * 心跳响应下发的模块清单（第一刀全部硬编码 active，无真实 DB 查询）。
 * key 用 Line 命名，与 Agent preflight / Dashboard 看板对齐。
 */
export const HEARTBEAT_MODULES: Record<string, ModuleDescriptor> = {
  'line04-wechat-cs': { status: 'active', required_version: '1.0.76' },
  'line01-publish': { status: 'active', required_version: '1.0.1' },
  'line02-lead-gen': { status: 'active', required_version: '1.0.1' },
  'line05-video': { status: 'active', required_version: '1.0.1' },
};

/**
 * 核心自升级（Sprint 06222100）：心跳下发的 Agent 核心运行时本体的要求版本。
 *
 * 模块（line04 等）走 HEARTBEAT_MODULES.required_version 自升级，核心 node 运行时本体一直没有
 * 自升级信号——核心改了客户机仍跑旧核心要人手动重装。这里给核心补上同机制的"要求版本"信号。
 *
 * 单一来源（防版本漂移）= install pack manifest.version（CI build-install-pack.sh 发布时写的
 * 已发布最新核心版本）。manifest 不可读时回退内置常量，永不返回空（防客户端无所适从）。
 */
export interface RequiredAgentVersion {
  version: string;
  sha256?: string;
  size?: number;
}

// manifest 不可读时的兜底版本。必须 <= 已发布的最新核心，且随核心 bump 同步抬高。
// bump 到 2.0.28：图标三连坑收口。2.0.25 pkg 后 rcedit 截断 overlay；2.0.26/2.0.27 改成 pkg 前给
// base 写图标但图标没生效——真因（xian-rog 真机用 pkg-fetch 源码定位）：pkg.need() 会校验 base 的
// hash，rcedit 改了 base→hash 变→pkg 判不符**重新下原版（绿图标）base 覆盖**。2.0.28 在写完图标后
// 把新 hash patch 进 pkg-fetch EXPECTED_HASHES，pkg 复用带蓝 logo 的 base。CI 图标 gate 兜底守卫。
// 兜底抬到 2.0.29，让 manifest 读不到时新客户机也直接解析到图标对的版本。
// 2.0.29：start.bat 全量 ASCII 化——修客户机装机日志满屏 'xxx is not recognized'（chcp 65001 下
// cmd 把中文 REM/echo 残片当命令跑）。start.bat 是 build-install-pack.sh 直接 cp 的文本资产，不进 exe，
// 不碰 2.0.28 的 pkg-fetch EXPECTED_HASHES / 图标 overlay 链。install-pack-ascii guard 接 CI 防回归。
// 2.0.32：① 模块 OTA 原子升级——modulesRoot 残缺目录不再毒化 getInstalledVersion（修客户机卡 line04
// 1.0.62 永不自升级→扫好友 401 真因）：下载到 staging→校验 manifest→原子 rename→失败回滚 + 开机自检
// activated==required 上报；② Windows 托盘图标改喂 ICO（systray2 文档要求 win32 用 .ico，旧版喂 PNG
// 渲染失败=用户长期看到的「错 logo」，与 exe 应用图标无关）。
// 2.0.41：杀旧 listen_chat 孤儿 listener（start.bat 单实例守卫 + OTA killModuleTree 杀进程树）+
// preflight 并发跳过不报假"未安装"+ 安装包 ZENITHJOY_ENV 选 staging/prod（hand-off 微信客服 agent 核心清理）。
// 核心包按约定 install-pack/zenithjoy-agent-v2.0.41.tar.gz 从 COS 下载（live 源是已发布 manifest，本常量仅兜底）。
export const DEFAULT_REQUIRED_AGENT_VERSION = '2.0.41';

/**
 * 返回心跳要下发的核心要求版本。
 * @param readManifest 注入 manifest 读取器（默认走 install-pack-manifest），便于单测。
 */
export function getRequiredAgentVersion(
  readManifest?: () => { version: string; sha256?: string; size?: number } | null,
): RequiredAgentVersion {
  // 默认走 install-pack manifest（单一来源）；测试可注入 readManifest 控制返回
  const reader = readManifest ?? readInstallPackManifest;
  try {
    const m = reader();
    if (m && typeof m.version === 'string' && /^\d+\.\d+\.\d+$/.test(m.version)) {
      return { version: m.version, sha256: m.sha256, size: m.size };
    }
  } catch {
    // fall through to default
  }
  return { version: DEFAULT_REQUIRED_AGENT_VERSION };
}

/** module-health 端点返回的单行（一台机器一行） */
export interface ModuleHealthRow {
  agent_id: string;
  hostname: string | null;
  module_status: ModuleStatusMap;
  updated_at: string | null;
}

export type LicenseFailureCode =
  | 'INVALID_LICENSE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'NO_TENANT';

export interface LicenseFailure {
  ok: false;
  code: LicenseFailureCode;
  message: string;
}

export interface LicenseSuccess {
  ok: true;
  license: LicenseRowMin;
}

/**
 * 用 license_key（ZJ-X-XXXXXXXX）查询并校验：active + 未过期 + 已绑 tenant。
 * 失败时返回结构化错误，调用方按需映射 HTTP 状态码。
 */
export async function validateLicense(
  licenseKey: string
): Promise<LicenseSuccess | LicenseFailure> {
  if (typeof licenseKey !== 'string' || !licenseKey.trim()) {
    return { ok: false, code: 'INVALID_LICENSE', message: 'license 缺失' };
  }
  const { rows } = await pool.query<LicenseRowMin>(
    `SELECT id, license_key, tenant_id, status, expires_at
       FROM zenithjoy.licenses
      WHERE license_key = $1
      LIMIT 1`,
    [licenseKey.trim()]
  );
  const license = rows[0];
  if (!license) {
    return { ok: false, code: 'INVALID_LICENSE', message: 'license 不存在' };
  }
  if (license.status === 'revoked') {
    return { ok: false, code: 'REVOKED', message: 'license 已吊销' };
  }
  if (license.status === 'suspended') {
    return { ok: false, code: 'SUSPENDED', message: 'license 已暂停' };
  }
  if (license.status === 'expired') {
    return { ok: false, code: 'EXPIRED', message: 'license 已过期' };
  }
  if (new Date(license.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED', message: 'license 已过期' };
  }
  if (!license.tenant_id) {
    return { ok: false, code: 'NO_TENANT', message: 'license 未关联 tenant' };
  }
  return { ok: true, license };
}

/**
 * 心跳进来时找/建 agent 记录。
 * 主键约定：在 (license_id, hostname) 唯一定位一台机器；hostname 缺失时退化成 license_id 维度。
 */
export async function upsertAgentByHeartbeat(args: {
  licenseId: string;
  tenantId: string;
  hostname: string | null;
  version: string | null;
  osType?: string | null;
  /** 若 Agent 侧在心跳 body 中携带了自身 UUID，优先按 WHERE id=$agentUuid 精确 UPDATE，
   *  命中则跳过 (license_id, hostname) 去重逻辑，防止 hostname=null 时新建幽灵行。
   *  未传或未匹配时退化到原有逻辑（向后兼容）。*/
  agentUuid?: string;
}): Promise<AgentRow> {
  const { licenseId, tenantId, hostname, version, osType, agentUuid } = args;

  // ── 精确路径：按 agentUuid 直接 UPDATE（跳过 hostname 去重，防幽灵行） ──
  if (agentUuid) {
    const precise = await pool.query<AgentRow>(
      `UPDATE zenithjoy.agents
          SET version          = COALESCE($1, version),
              hostname         = COALESCE($2, hostname),
              os_type          = COALESCE($4, os_type),
              last_heartbeat_at = now(),
              last_seen        = now(),
              status           = 'online',
              updated_at       = now()
        WHERE id = $3
          AND license_id = $5
        RETURNING id, tenant_id, agent_id, hostname, version, license_id,
                  bound_folder_path, last_heartbeat_at, status, last_seen`,
      [version, hostname, agentUuid, osType ?? null, licenseId],
    );
    if (precise.rows[0]) {
      // 如果 license 还没有 pinned_agent，把这台设为 pinned
      await pool.query(
        `UPDATE zenithjoy.licenses SET pinned_agent_id = $1
          WHERE id = $2 AND pinned_agent_id IS NULL`,
        [precise.rows[0].id, licenseId],
      );
      return precise.rows[0];
    }
    // agentUuid 未命中（极少情况：UUID 错或行被删）→ 退化到 (license_id, hostname) 逻辑
  }

  // ── 原有路径：按 (license_id, hostname) 去重 ──
  const existing = await pool.query<AgentRow>(
    `SELECT id, tenant_id, agent_id, hostname, version, license_id,
            bound_folder_path, last_heartbeat_at, status, last_seen
       FROM zenithjoy.agents
      WHERE license_id = $1
        AND ((hostname IS NULL AND $2::text IS NULL) OR hostname = $2)
      ORDER BY created_at ASC
      LIMIT 1`,
    [licenseId, hostname]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const updated = await pool.query<AgentRow>(
      `UPDATE zenithjoy.agents
          SET version = COALESCE($1, version),
              os_type = COALESCE($3, os_type),
              last_heartbeat_at = now(),
              last_seen = now(),
              status = 'online',
              updated_at = now()
        WHERE id = $2
        RETURNING id, tenant_id, agent_id, hostname, version, license_id,
                  bound_folder_path, last_heartbeat_at, status, last_seen`,
      [version, row.id, osType ?? null]
    );
    // 如果 license 还没有 pinned_agent，把这台设为 pinned
    await pool.query(
      `UPDATE zenithjoy.licenses SET pinned_agent_id = $1
        WHERE id = $2 AND pinned_agent_id IS NULL`,
      [row.id, licenseId]
    );
    return updated.rows[0];
  }

  // 新建：agent_id 用 'ws1-' 前缀 + 随机十六进制，避免与既有 v1.1 注册流的 agent_id 冲突
  const agentText = `ws1-${crypto.randomBytes(8).toString('hex')}`;
  const inserted = await pool.query<AgentRow>(
    `INSERT INTO zenithjoy.agents
       (tenant_id, license_id, agent_id, hostname, version, os_type, capabilities, status,
        last_heartbeat_at, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, ARRAY['douyin']::text[], 'online', now(), now())
     RETURNING id, tenant_id, agent_id, hostname, version, license_id,
               bound_folder_path, last_heartbeat_at, status, last_seen`,
    [tenantId, licenseId, agentText, hostname, version, osType ?? null]
  );
  // 新机器首次连接，如果 license 还没有 pinned_agent，自动 pin 这台
  await pool.query(
    `UPDATE zenithjoy.licenses SET pinned_agent_id = $1
      WHERE id = $2 AND pinned_agent_id IS NULL`,
    [inserted.rows[0].id, licenseId]
  );
  return inserted.rows[0];
}

/**
 * 拉指定 agent 的待派发任务（pending / queued / dispatched — H-1 canonical pre-execution states）
 *
 * H-2 Bug 9 layer 4: Sprint B-1 burner / Sprint A 等新 endpoint INSERT 用 'queued'
 * (canonical per H-1 status enum migration)。本方法旧版仅 status='pending' →
 * 漏 'queued' task → Agent 永远拉不到 → chrome 没弹。今日 ssh rog 真验暴露。
 * 修：扩到 H-1 canonical pre-execution 三态 (pending / queued / dispatched)。
 */
export async function getQueuedTasks(agentId: string): Promise<PublishTaskRow[]> {
  const { rows } = await pool.query<PublishTaskRow>(
    `SELECT id, agent_id, platform, status, type, folder_path, result, receipt_at, created_at, payload
       FROM zenithjoy.publish_tasks
      WHERE agent_id = $1 AND status IN ('pending', 'queued', 'dispatched')
      ORDER BY created_at ASC`,
    [agentId]
  );
  return rows;
}

/** 找 agent；返回 null 表示不存在（给 folder_bind / publish/task 用） */
export async function findAgentById(agentId: string): Promise<AgentRow | null> {
  const { rows } = await pool.query<AgentRow>(
    `SELECT id, tenant_id, agent_id, hostname, version, license_id,
            bound_folder_path, last_heartbeat_at, status, last_seen
       FROM zenithjoy.agents
      WHERE id = $1
      LIMIT 1`,
    [agentId]
  );
  return rows[0] ?? null;
}

/**
 * 文件夹绑定：
 *   1) UPDATE agents.bound_folder_path
 *   2) INSERT publish_tasks(platform='folder_bind', folder_path) — Agent 下次 heartbeat 拉到
 */
export async function bindFolder(args: {
  agentId: string;
  localPath: string;
}): Promise<{ taskId: string }> {
  const { agentId, localPath } = args;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE zenithjoy.agents
          SET bound_folder_path = $1, updated_at = now()
        WHERE id = $2`,
      [localPath, agentId]
    );
    const ins = await client.query<{ id: string }>(
      `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, folder_path, status)
       VALUES ($1, 'folder_bind', $2, 'pending')
       RETURNING id`,
      [agentId, localPath]
    );
    await client.query('COMMIT');
    return { taskId: ins.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type PublishTaskType = 'video' | 'image' | 'article';

const VALID_PUBLISH_TYPES: ReadonlySet<string> = new Set(['video', 'image', 'article']);

export function isValidPublishType(t: unknown): t is PublishTaskType {
  return typeof t === 'string' && VALID_PUBLISH_TYPES.has(t);
}

/** 创建发布任务 */
export async function createPublishTask(args: {
  agentId: string;
  platform: string;
  type?: PublishTaskType;
  folderPath?: string | null;
  payload?: unknown;
}): Promise<PublishTaskRow> {
  const { agentId, platform, folderPath = null, payload } = args;
  const type: PublishTaskType = isValidPublishType(args.type) ? args.type : 'image';

  // [type-route] 第 1 环节日志：中台写入 publish_task 时的 type
  console.log(`[type-route] createPublishTask agent=${agentId} platform=${platform} type=${type}`);

  const resultJson = payload == null ? null : JSON.stringify({ payload });
  const { rows } = await pool.query<PublishTaskRow>(
    `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, type, folder_path, status, result)
     VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)
     RETURNING id, agent_id, platform, type, status, folder_path, result, receipt_at, created_at`,
    [agentId, platform, type, folderPath, resultJson]
  );
  return rows[0];
}

/** Agent 上报回执：更新任务状态 + result + receipt_at */
export async function submitPublishReceipt(args: {
  taskId: string;
  status: 'success' | 'failed';
  result: unknown;
}): Promise<PublishTaskRow | null> {
  const { taskId, status, result } = args;
  const { rows } = await pool.query<PublishTaskRow>(
    `UPDATE zenithjoy.publish_tasks
        SET status = $1,
            result = $2::jsonb,
            receipt_at = now()
      WHERE id = $3
      RETURNING id, agent_id, platform, status, folder_path, result, receipt_at, created_at`,
    [status, result == null ? null : JSON.stringify(result), taskId]
  );
  return rows[0] ?? null;
}

/** 单条任务查询 */
export async function getPublishTask(taskId: string): Promise<PublishTaskRow | null> {
  const { rows } = await pool.query<PublishTaskRow>(
    `SELECT id, agent_id, platform, status, folder_path, result, receipt_at, created_at
       FROM zenithjoy.publish_tasks
      WHERE id = $1
      LIMIT 1`,
    [taskId]
  );
  return rows[0] ?? null;
}

/** 查找 tenant 下最近活跃（10 分钟内有心跳）的 agent */
export async function findActiveAgentByTenantId(tenantId: string): Promise<AgentRow | null> {
  const { rows } = await pool.query<AgentRow>(
    `SELECT id, tenant_id, agent_id, hostname, version, license_id,
            bound_folder_path, last_heartbeat_at, status, last_seen
       FROM zenithjoy.agents
      WHERE tenant_id = $1
        AND last_heartbeat_at > NOW() - INTERVAL '10 minutes'
      ORDER BY last_heartbeat_at DESC
      LIMIT 1`,
    [tenantId]
  );
  return rows[0] ?? null;
}

/**
 * 持久化客户端上报的模块 preflight 结果到 agents.module_status（jsonb，存最新一份）。
 * agentId = zenithjoy.agents.id（心跳返回的 agent_id）。
 */
export async function saveModuleStatus(
  agentId: string,
  moduleStatus: ModuleStatusMap
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.agents
        SET module_status = $2::jsonb, updated_at = now()
      WHERE id = $1`,
    [agentId, JSON.stringify(moduleStatus)]
  );
}

/**
 * 读取所有已注册机器的模块健康矩阵，供 Dashboard 看板渲染。
 * 按 updated_at 倒序，每台机器一行。
 */
export async function getAllModuleHealth(): Promise<ModuleHealthRow[]> {
  const { rows } = await pool.query<ModuleHealthRow>(
    `SELECT id AS agent_id, hostname, module_status, updated_at
       FROM zenithjoy.agents
      ORDER BY updated_at DESC NULLS LAST`
  );
  return rows;
}

export class NoAgentError extends Error {
  readonly code = 'NO_AGENT';
  constructor() {
    super('请先安装并启动 Agent');
    this.name = 'NoAgentError';
  }
}

export class TaskNotFoundError extends Error {
  readonly code = 'TASK_NOT_FOUND';
  constructor(taskId: string) {
    super(`task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('forbidden');
    this.name = 'TaskForbiddenError';
  }
}

/**
 * 派发发布任务：
 *   1) 找当前 tenant 活跃 agent（10 分钟内心跳）
 *   2) 事务内：INSERT publish_tasks（result.payload.work_id）+ UPDATE works.publish_status='queued'
 *   3) 返回 {task_id, status: 'queued'}
 */
export async function dispatchPublishTask(args: {
  workId: string;
  tenantId: string;
}): Promise<{ task_id: string; status: 'queued' }> {
  const { workId, tenantId } = args;

  const agent = await findActiveAgentByTenantId(tenantId);
  if (!agent) {
    throw new NoAgentError();
  }

  const resultJson = JSON.stringify({ payload: { work_id: workId } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query<{ id: string }>(
      `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, type, status, result)
       VALUES ($1, 'douyin', 'video', 'queued', $2::jsonb)
       RETURNING id`,
      [agent.id, resultJson]
    );
    const taskId = ins.rows[0].id;

    await client.query(
      `UPDATE zenithjoy.works
          SET publish_status = 'queued', updated_at = now()
        WHERE id = $1`,
      [workId]
    );

    await client.query('COMMIT');
    return { task_id: taskId, status: 'queued' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Agent 确认任务完成：
 *   1) 查 publish_tasks 记录（404 if not found）
 *   2) 验 agent.license_id = licenseId（403 if cross-tenant）
 *   3) 事务内：UPDATE publish_tasks.status='done' + UPDATE works.publish_status='success'
 *   4) 返回 {ok: true}
 */
export async function ackPublishTask(args: {
  taskId: string;
  licenseId: string;
  result: string;
}): Promise<{ ok: true }> {
  const { taskId, licenseId, result } = args;

  const taskRes = await pool.query<{ id: string; agent_id: string; platform: string; result: unknown }>(
    `SELECT id, agent_id, platform, result
       FROM zenithjoy.publish_tasks
      WHERE id = $1
      LIMIT 1`,
    [taskId]
  );
  const task = taskRes.rows[0];
  if (!task) {
    throw new TaskNotFoundError(taskId);
  }

  const agentRes = await pool.query<{ id: string; license_id: string | null }>(
    `SELECT id, license_id FROM zenithjoy.agents WHERE id = $1 LIMIT 1`,
    [task.agent_id]
  );
  const agent = agentRes.rows[0];
  if (!agent || agent.license_id !== licenseId) {
    throw new TaskForbiddenError();
  }

  const workId =
    (task.result as { payload?: { work_id?: string } } | null)?.payload?.work_id ?? null;

  // qr_bind_* task 成功 → 同步写 agent_platform_sessions（Dashboard 读这张表显示绑定状态）
  const qrBindMatch = task.platform.match(/^qr_bind_(.+)$/);
  const isQrBindSuccess = !!qrBindMatch && result === 'success';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE zenithjoy.publish_tasks
          SET status = 'done',
              result = $1::jsonb,
              receipt_at = now()
        WHERE id = $2`,
      [JSON.stringify({ result, payload: { work_id: workId } }), taskId]
    );

    if (workId) {
      await client.query(
        `UPDATE zenithjoy.works
            SET publish_status = 'success', updated_at = now()
          WHERE id = $1`,
        [workId]
      );
    }

    if (isQrBindSuccess) {
      const platformName = qrBindMatch![1]; // e.g. 'douyin'
      await client.query(
        `INSERT INTO zenithjoy.agent_platform_sessions
           (agent_id, platform, account_label, status, bound_at)
         VALUES ($1, $2, 'default', 'active', now())
         ON CONFLICT (agent_id, platform, account_label)
         DO UPDATE SET status = 'active', bound_at = now()`,
        [task.agent_id, platformName]
      );
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
