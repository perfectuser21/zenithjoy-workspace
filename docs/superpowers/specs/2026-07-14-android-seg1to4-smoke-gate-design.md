# 设计：安卓挖客守卫从 Seg1 扩成 Seg1-4 端到端

日期：2026-07-14
分支：cp-07140718-android-seg1to4-smoke
关联：sprints/07140718-android-seg1to4-smoke-gate/prep-prd.md、handoff_0714_android_e2e_glue

## 问题

安卓端挖客链路（Line02）四段（采集 Seg1 → 内容判定 Seg2 → 抓评论者 Seg3 → 私信派单 Seg4）
的段间代码早已自动接线（分布式状态机 + fire-and-forget 副作用），但 CI 守卫
`line02-android-collect-realmachine-smoke.sh` **只断言到 Seg1（采集≥2）**。后 3 个接线点无守——
某段一改接线断了，当晚没人知道。目标：把这条真机 smoke 延长成 Seg1-4 端到端守卫。

## 方案（已选）

一条真机 smoke 串起全链断言 + 一个只读 API 字段做数据源。理由：段间是异步 fire-and-forget，
唯有一条"派任务→轮询到底"的真机 smoke 能真正证明粘合成立；判定结果 `judgment_status` 目前
无 GET 端点暴露，补一个只读字段比往真机 runner 塞 staging DB 凭据更干净、且字段本身有可观测价值。

### 组件 1：`GET /collect-tasks/:id/videos` 补判定字段（apps/api/src/routes/acquisition.ts）

纯只读加字段，向后兼容（老字段全保留）。三处改动：
- 行内返回类型补 `judgment_status: string;`、`judgment_reason: string | null;`
- SELECT 补 `judgment_status, judgment_reason`（表 `acquisition_collect_videos`，列有 `DEFAULT 'pending'`，恒有值）
- map 每个 video 对象补这两个字段

**接口契约**：`GET /api/acquisition/collect-tasks/:id/videos` 响应 `.data.videos[]` 每项新增
`judgment_status`（pending|matched|rejected）与 `judgment_reason`（string|null）。其余不变。

### 组件 2：smoke 脚本追加 Seg2-4 断言（line02-android-collect-realmachine-smoke.sh）

现有 4 步（环境自检/派任务/轮询采集终态/断言 collected≥2）**全部不动**，在其后追加：

- **Seg2 判定**：轮询 `collect-tasks/:id/videos`（≤3min），等所有采集视频 `judgment_status` 非 pending。
  - 断言 `judged≥1`（有非 pending），否则 `fail`——判定链未跑（疑 MediaProjection 授权失效/agent 未上报 /judge-video，即 handoff 风险①"判定虚过"照妖镜）。
  - 记录 `matched` 数供后续条件判断。
- **Seg3 抓评论者**（仅当 `matched≥1`）：轮询 `collect/:task_id` 的 `.data.lead_count_raw`（≤3min），
  断言 `>0`，否则 `fail`——Seg2→Seg3 接线断。
- **Seg4 私信派单**（仅当 Seg3 验过）：轮询 `dispatch/plan` 的 `.data.total`（≤2min），
  断言 `>0`，否则 `fail`——Seg3→Seg4 接线断。
- **判定全 rejected（matched=0）**：log 黄字跳过 Seg3/4——合法业务结果（视频不匹配目标画像），
  判定链本身正常，非红。

## 数据流

```
collect/start(装修) → 真机 DouyinCollectService 采集 → report-videos(status=stage_1_done)
  → [agent 逐视频截图→judge-video→Gemini] → acquisition_collect_videos.judgment_status
  → [judgment!=rejected → Stage2] → 抓评论者 → acquisition_leads(lead_count_raw)
  → [collect/report COMMIT afterCommit → buildAssignments→dispatchDue] → dm_assignments(dispatch/plan)
smoke: 派任务 → 轮询采集 → 轮询判定(新字段) → 轮询leads → 轮询dispatch → PASS
```

## 错误处理 / 边界

- 判定异步（agent 逐视频截图 + Gemini 8s/视频），Seg2 给 3min 轮询窗口。
- **Seg2 轮询退出条件 = `judged≥1 且连续2轮 pending 数不变，或超时`；最终断言 `judged≥1`**。
  不可用"等全部视频非 pending"做退出——`judgment_status` 合法留 pending 的分支不止授权失效
  （content-judgment.ts：force_timeout/no_api_key/Gemini parse-error 均落 pending），某视频可能
  永久 pending，"等全部"会白烧满 3min 窗口。
- 授权失效 → 判定恒 pending → judged=0 → Seg2 `fail`（这是守卫的价值，不是缺陷）。
- 判定全 rejected → Seg3/4 跳过（黄字，非红）——见判定点登记表。
- Seg4 断言用租户级 `dispatch/plan.total>0`（无 task 级派单查询端点）；精度弱但"派单链断"
  仍会被"lead_count_raw>0 却 total=0"抓到。
- 所有 curl 沿用现有 `-fsSk`（runner curl.exe 证书）+ jq `.data` 层（#1276/#1278 教训）。

## 测试策略

- **组件 1（逻辑接缝）**：vitest——落点 `apps/api/src/routes/acquisition.test.ts` 的
  `describe('GET /api/acquisition/collect-tasks/:id/videos ...')`（约 :954）。DB 是 mock
  （`vi.mock('../db/connection')`），在 videos 的 mock row 补 `judgment_status`/`judgment_reason`，
  断言 `res.body.data.videos[0]` 含该属性。现 map 无该字段 → failing-first 成立（commit-1 红 / commit-2 绿）。
- **组件 2（环境接缝）**：smoke 脚本是真机环境守卫，CI 干净环境测不到——靠 xian-rog
  `workflow_dispatch` 跑绿证明（刀3，PR merge 后手动触发）。shellcheck 保语法。
  proven-to-fire：真机跑时判定全 pending 应看到 Seg2 报红（授权失效照妖镜验证）。
- **PR CI 范围**：yml 的 PR required gate 本刀**不打开**（保持 nightly + workflow_dispatch），
  待扩展后连续数晚绿再单独 PR 打开。本 PR 的 CI = vitest + lint + 现有 gate 不破。

## 不包含

- 采集代码修复（NO_SEARCH_INPUT/SEARCH_TIMEOUT/多卡退化已由 #1230/#1231/#1273/#1274 根治）。
- 企微 Seg5（收友→AI首答，代码零，独立立项）。
- 打开 yml PR required gate（后续刀）。
