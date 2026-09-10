# 刀A：agent-android 发布基座段纯代码化（领单→claim→下载→落相册）设计

日期：2026-09-10 · 分支：cp-09101210-agent-publish-pull · 决策：phase3 主理人拍板（基座段确定性 IO 不用 AI 驾驶）· 前身 headless 任务 749a9efd/517334e8（流水线三连墙，转交互）

## 范围（刀A 只做基座段，App 内平台操作留刀B）

手机上常驻的 agent-android 自动完成：发现排队中的发布单 → 原子认领 → 下载发布包素材 → 写入相册 + 媒体扫描。之后 AI 执行器（android-publish skill）接手 App 内操作时素材已在相册，跳过 ADB push 环节；终态回执仍由执行发布的一方回。

## 关键决策

1. **通道**：不动心跳通道（刀1 显式排除 content_publish 防旧 agent 误领，`walking-skeleton.service.ts:423` 保持原样）。agent 新增第 4 条轮询线 `PublishPollLoop`（30s，照 `AcquisitionCollectPollLoop` 模式），直接打现有 `GET /api/publish-tasks?status=queued`。
2. **鉴权**：`X-Upload-Token: config.licenseKey`——与 AI 执行器同一凭据同一 header（`AgentConfig.licenseKey` 就是 `validateLicense` 认的 key），不新造第四套。
3. **防重复领单**：中台新增 `POST /api/publish-tasks/:id/claim`——CAS `status queued→dispatched`，抢到返回 200 `{claimed:true}`，已被抢/非 queued 返回 200 `{claimed:false, status}`（不用 409，语义是正常竞争不是错误）。agent 抢到才下载；多机同租户从此安全。
4. **落相册**：Q+（API 29+）走 `MediaStore.Images/Video` insert（无需权限）；API 26-28 声明 `WRITE_EXTERNAL_STORAGE`（maxSdkVersion 28）+ legacy `/sdcard/DCIM/Camera` 写入 + `MediaScannerConnection.scanFile`。文件名用发布包 `file_name`（已是相机风格）。
5. **失败语义 fail-visible**：claim 后下载/落相册失败 → `PATCH /:id/receipt {result:'failed', detail:'<步骤+现象>'}`——编排台立刻看到"派发失败"，latest-wins 重发兜底；绝不静默留 dispatched 黑洞。下载前失败（claim 没抢到）零副作用。
6. **AI 执行器衔接**：skill 侧后续把领单协议从"查 queued"改为"查 dispatched + 素材已在相册"（本刀不改 skill，仍兼容：AI 查 queued 会看不到已被 agent 认领的单，改查 dispatched 即可——写进 not_done/next_steps）。

## 改动清单

### 中台（apps/api）
- `routes/publish-dispatch.ts`：新增 `POST /:id/claim`（authenticate 同款、UUID 校验、CAS UPDATE `SET status='dispatched' WHERE id=$1 AND tenant_id=$2 AND status='queued'`、rowCount 判 claimed、限流沿用 router 级）
- 单测 `routes/__tests__/publish-dispatch.test.ts`：抢到/被抢/非法 UUID/租户隔离 4 例
- smoke `content-publish-dispatch-smoke.sh` 加 claim 关卡（GP-Anchor 触碰）

### agent-android（services/agent-android）
- 新 `publish/PublishPollLoop.kt`：30s 轮询 queued（no-pool OkHttp，照 `InfrequentHttpClientsNoPoolTest` 约束）→ 逐单 claim → 领包 → 下载到 `cacheDir` → 落相册 → 清理 cache；每个丢弃/失败分支留日志（照 AcquisitionCollectPollLoop 的留痕纪律）
- 新 `publish/MediaSaver.kt`：Q+ MediaStore / legacy 双路径
- `AgentService.kt`：启动/销毁挂 loop（照现有三条 loop 的接线）
- `AndroidManifest.xml`：`WRITE_EXTERNAL_STORAGE maxSdkVersion=28`
- `DebugE2ERouter.kt`：加 `publish` flow（真机可 adb 触发单轮）
- `build.gradle.kts`：versionCode 53 / versionName 2.1.49（改 agent 必 bump）
- 单测：PublishPollLoop 判别/失败分支（MockWebServer）、MediaSaver 路径选择（静态断言风格）、no-pool 守卫自动覆盖

## 验收
- [ ] 双侧 TDD：commit-1 tests 红（中台 vitest + 安卓 gradle）、commit-2 转绿
- [ ] CI 全绿（android-agent-ci gate + api tests + smoke）
- [ ] 真机 E2E（合并部署后）：staging 建带素材的 publish 单 → 金诺机 agent（装新 APK）自动 claim→下载→相册出现素材 → DB 状态 queued→dispatched
