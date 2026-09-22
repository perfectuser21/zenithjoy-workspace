import dotenv from 'dotenv';
import http from 'http';
import app from './app';
import { attachAgentWS } from './services/agent-ws';
import { attachCollabWS } from './services/collab-ws';
import { startStaleListenerMonitor } from './services/wechat-heartbeat';
import { startAgentOfflineMonitor } from './services/agent-offline-monitor';
import { startScheduler } from './services/scheduler';
import { startWorkerLeaseSweeper } from './services/worker-lease-sweeper';
import { startNotionOrchestrator } from './services/notion-orchestrator';
import { startFeishuOrchestrator } from './services/feishu-orchestrator';
import { startPublishRollup } from './services/publish-rollup';
import {
  runStartupConfigCheck, runStartupBinaryCheck, runStartupFontCheck,
  runPaymentFileCheck, checkPaymentEnvSanity,
} from './startup-check';
import { assertStaffDirectoryOnStartup } from './staff-directory';
import { assertSingleOrgMembership } from './startup/single-org-selfcheck';
import { registerRealProvidersFromEnv } from './services/payment/provider-registry';
import pool from './db/connection';

dotenv.config();

// 启动早期自检关键 env（哨兵）：缺 key 大声打红日志但不崩进程。
// 治根 2026-06-19 生产漏 TOAPI_API_KEY → 客服静默不回。
runStartupConfigCheck();

// 启动早期自检关键运行时二进制（哨兵扩展）：缺可执行文件同样大声打红日志但不崩进程。
// 治根 2026-09-19 生产/staging 镜像漏 ffmpeg → 批量混剪渲染静默 fail-closed。
runStartupBinaryCheck();

// 启动早期自检字体注册数量（同一道闸的扩展）：0 条字体大声打红日志但不崩进程。
// 治根 P0 issue 357861c4——生产容器有 subtitles 滤镜但没有字体，ffmpeg 烧字幕
// 退出码仍为 0、文件仍生成，只是字幕没画上（静默失效）。
runStartupFontCheck();

// 启动早期自检支付凭据文件（Task 11，同一道闸的扩展）：私钥/证书文件缺失或损坏
// 时大声打红日志但不崩进程（fail-open）——支付只是这个 API 的一个子功能，不该
// 因为证书路径配错拖垮全站其它业务线；具体不可用信号已由 registerRealProvidersFromEnv()
// 的 providerInitErrors 经 /health 暴露（C-1），这里只是让同一类问题在启动更早期可见。
runPaymentFileCheck();

// 进程级安全网：单个路由的未捕获 Promise rejection（Node 15+ 默认行为）会杀死整个进程，
// 拖垮同机所有其它无关请求/CI smoke（2026-07-09 PR#1207 实测：cookie-health 一次未捕获异常
// 打崩整个 apps/api，级联导致同一 CI job 后续所有 smoke 脚本连 000 connection refused）。
// 只打红日志不退出，路由自身的 500 由各自 handler/Express 默认错误中间件处理。
process.on('unhandledRejection', (reason) => {
  console.error('🔴 [unhandledRejection] 未捕获的 Promise 拒绝，已拦截，进程不退出:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔴 [uncaughtException] 未捕获的异常，已拦截，进程不退出:', err);
});

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
attachAgentWS(server);
// 路② 协同笔记实时协作房（Yjs over WS），路径 /collab-ws，独立于 /agent-ws
attachCollabWS(server);

/**
 * A30 员工目录一致性自检 —— fail-closed 启动闸，必须在 listen 之前跑完。
 * 目录声明写错（分组与扁平名单对不上 / 某人被声明在两家 / STAFF_ORG_MAP 指向不存在的租户）
 * 的后果全是静默的跨企业事故，只能在启动期拦住，绝不能"先起来再说"。
 *
 * 注意：unhandledRejection/uncaughtException 两个进程级兜底会把异常拦下来不退出，
 * 所以这里必须显式 process.exit(1)，否则自检失败照样起服务。
 */
async function bootstrap(): Promise<void> {
  try {
    await assertStaffDirectoryOnStartup(process.env, pool);
  } catch (err) {
    console.error(`🔴 [staff-directory] ${(err as Error).message}`);
    console.error('🔴 [staff-directory] 员工目录一致性自检未通过，拒绝启动（fail-closed）');
    process.exit(1);
  }

  // A11 单组织自检 —— 同上，必须在 listen 之前。一个员工被声明进两家企业时，
  // "先起来再说"的后果是他建的表进了别人家，而且没有任何信号。
  try {
    await assertSingleOrgMembership(pool);
  } catch (err) {
    console.error(`🔴 [single-org] ${(err as Error).message}`);
    console.error('🔴 [single-org] 单组织归属自检未通过，拒绝启动（fail-closed）');
    process.exit(1);
  }

  // Task 11：防 staging/dev 误用生产商户号 —— 真实资金风险，与上面两道自检同级
  // fail-closed（process.exit），而非 registerRealProvidersFromEnv() 内部那种"配置
  // 格式错误"的 fail-open（C-1）。判据不同：这里挡的是"配置本身不该出现在这个环境"
  // （用错商户号），不是"配置写错了格式"——前者是真实资金风险，没有"先跑起来再说"的余地。
  const paymentSanityProblems = checkPaymentEnvSanity(process.env);
  if (paymentSanityProblems.length > 0) {
    console.error('==================================================================');
    console.error('🔴🔴🔴 支付环境自检失败：真实资金风险，拒绝启动（fail-closed）🔴🔴🔴');
    for (const p of paymentSanityProblems) console.error(`🔴 ${p}`);
    console.error('==================================================================');
    process.exit(1);
  }

  // 积分充值真实支付 provider：fail-open（C-1）——缺凭据时静默不注册；凭据齐了但加载
  // 抛异常（证书路径拼错/私钥格式不对等配置错误）同样不注册，但会打红日志并记入
  // getProviderInitErrors()（经 /health 暴露），两种情况都不阻塞启动、不拖垮进程。
  registerRealProvidersFromEnv();

  server.listen(PORT, () => {
    console.log(`🚀 Works Management API + Agent WS running on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   API docs: http://localhost:${PORT}/api/works`);
    console.log(`   Agent WS: ws://localhost:${PORT}/agent-ws`);
    // 选题池 v1 阶段2：老 pipeline-scheduler 已废除，改由 topic-worker.py LaunchAgent 每日 09:00 触发
    // 进程守护：每分钟检查微信监听心跳，断 3 分钟无心跳 → 飞书告警（FEISHU_ALERT_WEBHOOK）
    startStaleListenerMonitor();
    // 进程守护：每分钟扫描 Windows Agent 心跳，超阈值离线 → 飞书告警（FEISHU_ALERT_WEBHOOK）
    startAgentOfflineMonitor();
    // 中台定时调度器：日报结算(23:55北京)/朋友圈草稿(09:00)/warmup养号(10:00北京)/DM派单sweep(每分钟)。
    // 治根 2026-07-19：startScheduler() 建库以来从未被服务器进程调用过，四个周期任务全部静默不跑。
    startScheduler();
    // 工作机控制塔（决策 e14297d4）任务租约 sweeper：过期 running → failed/executor_lost，顺手驱逐闲置帧缓冲。
    // 从 app.ts 迁出（2026-08-30 后端审查）：门控用 VITEST（vitest 自动设置）而非 NODE_ENV
    // ——同文件顶部 app.ts 挂 auth 路由用的同一惯例，NODE_ENV=test 在 CI smoke 里也会被设置，不能用它当门控。
    if (!process.env.VITEST) startWorkerLeaseSweeper();
    // Notion 发布编排台同步 worker（line01 刀2）：env 不齐自己 return null，不阻塞启动。
    if (!process.env.VITEST) startNotionOrchestrator();
    // 飞书发布编排台同步 worker（line01 刀5b Task 3，镜像 Notion 版）：env 不齐
    // 或与 Notion 编排台租户冲突自己 return null，不阻塞启动。
    if (!process.env.VITEST) startFeishuOrchestrator();
    // 通用发布 rollup sweeper（刀5b Task 1）：无 env 依赖，永远启动——收敛 dashboard
    // 直派、从未挂过任何编排台锚的 queued 作品，防止它们永久卡在 queued。
    if (!process.env.VITEST) startPublishRollup();
  });
}

// C-1：bootstrap() 内部的支付 provider 加载已 fail-open（不会 reject）；这里补 .catch()
// 兜底其它真实启动故障（员工目录/单组织自检以外的意外异常）——启动阶段的其它真实故障
// 仍应让进程退出，但绝不能是因为支付凭据格式问题（那类异常已在 registerRealProvidersFromEnv
// 内部捕获，不会传播到这里）。
void bootstrap().catch((err) => {
  console.error('🔴 [bootstrap] 启动失败，进程退出:', err);
  process.exit(1);
});
