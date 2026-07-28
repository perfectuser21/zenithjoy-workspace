# Sprint PRD — Staff Hub 业务线健康看板（GP3 / line_health）

## OKR 对齐

- **对应 OKR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付（进度 77%）
- **对应 Journey**：ZenithJoy 运营中枢（`636a918c-8b23-4df5-baec-b1eb3308fffb`），挂在已 done 的「员工工具中心(Staff Tools Hub)」ability（`16ac50db-bbc1-4b08-b922-97e251eb57f3`）下，新增 feature「业务线健康看板」（journey_feature `5e92525a-19a8-4ef6-b7a4-c7cf8aa9cd10`，当前 status=planned）
- **本次推进预期**：把「业务线健康看板」feature 从 planned 推到 thin-done（总览页 + 详情页两个 tab 全部真实数据打通）

## 背景

员工目前要了解 3 条对外业务线（客户首次成功/客户智能获客/客户私域AI接管）各自的健康状态，只能挨个问线负责人或翻 GitHub，没有统一入口。PR #1486 已合并 `product-map/generated/product-map.json` 作为业务线清单权威来源，本 Sprint 在 Staff Hub 之上把它和 Brain journey_features、GitHub API 聚合成一个看板页，复用 GP2 已验收的 `PathHealthPage.tsx` + `apps/api/src/routes/staff.ts` 风格与降级模式。

## Golden Path

1. 员工在 Staff Hub 导航栏点开「业务线健康」总览页 → 调用 `GET /api/staff/line-health`，读 `product-map.json` 中 `customer_app` 下 3 条 line，逐条聚合 Brain `journey_features` 数据 → 展示 3 张卡片（maturity + done/total + smoke 状态），风格同 `PathHealthPage`
   - 加载态：3 个骨架卡片占位
   - line 在 Brain 无对应 journey（当前 line01/line02）：卡片显示专门的「未接入 Brain 数据」灰色徽章，不显示 0/0
   - 单条线 Brain 查询 5xx/timeout：该卡片单独标「数据暂不可达」，其余线正常展示（per-line 独立降级）
   - `product-map.json` 缺失/解析错误：全页降级为代码内置 3 条线兜底清单 + 顶部 banner 提示
2. 员工点击某条线卡片 → 跳转 `/line-health/:lineKey` 详情页，默认打开「部署」tab → 调用 `GET /api/staff/line-health/:lineKey/deployment`，展示 dev/staging/production 三环境状态 + 按该线相关代码路径过滤出的最近一次 commit sha（UI 文案写「最近相关提交」，不写「当前部署版本」）+ 关联 PR 清单（按 PR 标题关键词匹配，为空时显示「暂无标题匹配的近期 PR」而非空白）
   - 点击「未接入」状态的线：详情页仍可进入，两个 tab 均显示「该业务线尚未接入 Brain 数据，暂无法展示」空态
3. 员工切到「能力」tab → 调用 `GET /api/staff/line-health/:lineKey/abilities`，展示该线下 golden path/ability 清单（thickness + status），tab 间错误互相隔离（commit/PR/abilities 各自独立 try/catch）
4. 员工点返回 → 复用总览页已有数据即时展示，后台静默刷新

## 边界情况

- Brain 404（无数据）与 5xx/timeout（故障）必须区分展示，不可合并成统一「暂不可达」
- GitHub REST API 未认证 60 次/小时限额：GitHub 数据（commit/PR）缓存 5 分钟，Brain 数据不缓存或缓存 1 分钟
- 详情页任一 tab 数据源失败不得拖垮另一 tab 或总览页

## 范围限定

**在范围内**：`GET /api/staff/line-health` 系列 3 个端点、总览页、详情页两个 tab、四类降级路径、Playwright E2E
**不在范围内**：line01/line02 在 Brain 补真实 journey 结构；`product-map.json` 补 `owned_paths` 做精确关联PR过滤；按角色查看权限分级；各环境 `/version` 真实运行版本端点

## 假设

- 无遗留假设：PrepPRD 判定点登记表已对本 Sprint 全部技术歧义拍板（UI 状态/故障归因/版本定义/PR筛选/降级粒度/缓存TTL/权限均已确认）

## 预期受影响文件

- `apps/api/src/routes/staff.ts`：新增 `GET /api/staff/line-health`、`GET /api/staff/line-health/:lineKey/deployment`、`GET /api/staff/line-health/:lineKey/abilities` 三个端点
- `apps/api/src/routes/__tests__/staff.test.ts`：三个端点的单元/集成测试，含降级路径覆盖
- `apps/staff-hub/src/pages/LineHealthPage.tsx`（新建）：总览页，风格照抄 `PathHealthPage.tsx`
- `apps/staff-hub/src/pages/LineHealthDetailPage.tsx`（新建）：详情页，部署/能力两个 tab
- `apps/staff-hub/src/`（路由注册处）：新增 `/line-health` 与 `/line-health/:lineKey` 路由，接入现有 `staffGuard`
- `apps/staff-hub/e2e/line-health.spec.ts`（新建）：Playwright E2E，覆盖加载/点击/tab 切换/降级
- `product-map/generated/product-map.json`：只读依赖，不改动

## NFR 约束

<!-- 来源: PrepPRD 判定点登记表（主源，decisions 表本次无匹配副源） -->
- 超时/延迟: 单条线 Brain 查询超时按该卡片独立降级处理，不阻塞其余卡片
- 频控/缓存: GitHub 数据缓存 5 分钟；Brain 数据不缓存或缓存 1 分钟（GitHub REST 未认证 60次/小时限额，多员工同开会打满）
- 版本要求: 无特定第三方版本依赖
- 可观测: Brain 404（无数据）与 5xx/timeout（故障）必须区分记录/展示，不得合并判断

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本次均为空），58 条全量注入 -->
- [watchdog_overd] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [通知/写库接口的成功判定必须] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [dep-audit 因新披露] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [headed relay s] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（来源: area）
- [毕业（测试入册）commit] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [合同批准前必须同时记录 ma] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual:node -e] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [测试如果全部依赖"重置状态=] learning: 测试如果全部依赖"重置状态=冷启动"的写法，要专门补至少一条"真实多轮扫描、状态不重置"的集成测试（来源: area）
- [涉及"周期性重新扫描同一批数] learning: 涉及"周期性重新扫描同一批数据"且引入外部付费调用时，必须设计"是否已处理过"的前置检查（来源: area）
- [跨模块的"时间常数"（扫描间] learning: 跨模块时间常数存在隐含大小关系时，必须在设计阶段显式写不变量断言或注释（来源: area）
- [theater_mismat] theater_mismatch 检查机制：contract 文本含 android 关键词即使在排除列表也会触发，可用 target_environment=windows_cloud 绕过（来源: area）
- [target_environ] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读，任务注册时必须正确设置（来源: area）
- [Brain judge .b] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）（来源: area）
- [DB 表字段长度约束（如 `] learning: DB 表字段长度约束在写入前若来源数据无天然长度保证，必须显式截断（来源: area）
- [复活/重做一个曾经死过的功能] learning: 复活/重做曾死过的功能前，先用 git log --diff-filter=D 读退役前真实代码，逐字核对 death cause（来源: area）
- [调用任何"失败不抛异常，返回] learning: 调用"失败返回 null/false"契约的函数时，必须显式写 else 处理失败分支，不能只依赖外层 try/catch（来源: area）
- [journey_featur] learning: journey_features 表 updated_at 长期停滞可作为 report 阶段漏跑的兜底探针信号（来源: area）
- [harness-contro] learning: harness-controller relay 容器可能在 merge 后异常退出跳过 report，不应仅凭容器 exit code 0 判定（来源: area）
- [contract-propo] learning: contract-proposer 起草环境白名单类断言时强制核对 headed 人工接管场景（来源: area）
- [headed relay 点] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，分支名带 task short id（来源: area）
- [退役判断依据数据不靠记忆：本] learning: 退役判断依据数据不靠记忆，需查生产库实锤（cursor状态分布/表行数/消费方grep）拍板（来源: area）
- [catch 吞错的后台 jo] learning: catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表名认领冲突：建新表/复用表] learning: 表名认领冲突：建新表/复用表前先 grep 全部写入方，两模块写同一表须 schema 对齐评审（来源: area）
- [新增后台 job 必须同时声] learning: 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [多设备类型(os_type/] 涉及多个 os_type/device_platform 时，验收需确认展示层是否区分，不区分则 FAIL（来源: area）
- [同一语义（如 git_sha] learning: 同一语义在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [`git rev-parse] learning: git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 失败回显字面量（来源: area）
- [smoke/测试用真实 wo] learning: smoke/测试用真实 worktree 当部署根时，必须核对被测脚本是否会向上触碰生产资源（来源: area）
- [部署链任何失败路径禁止 wa] learning: 部署链任何失败路径禁止 warning 降级，须显式 FAIL 变量 + exit 非零（来源: area）
- [判变基准永远用"生产实体自报] learning: 判变基准永远用"生产实体自报"对账 origin/main，禁用"工作区 diff"（来源: area）
- [lint-test-qual] learning: lint-test-quality 要求 await fn() ≥ 1，读源码必须包装 async function，不能直接 readFileSync（来源: area）
- [Test Contract] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹（来源: area）
- [Red commit 必須只] learning: Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 混入非测试文件（来源: area）
- [回归测试用 source-c] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [新增 cron 功能首先检查] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [harness-genera] learning: harness-generator 禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [headed relay 的] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量（来源: area）
- [Proposer 复用历史合] learning: Proposer 复用历史合同模板前必须先核对本次任务真实派发/执行历史，不能假设与先例路径相同（来源: area）
- [给 harness-gene] learning: harness-generator 对共享 CI 基础设施文件（.github/workflows/*.yml 等）默认禁区（来源: area）
- [PR 被 should-au] learning: PR 被 CI 侧兜底机制提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定 sha（来源: area）
- [feat+brain/src] learning: feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [新 task_type 接线] learning: 新 task_type 接线用七点清单（CHECK约束/task-router四表/EXECUTOR_KIND_FOR等）（来源: area）
- [服务"该活着"的判定用双信号] learning: 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [本机（美国 Mac mini] learning: 本机（美国 Mac mini）禁止再往 ~/Library/LaunchAgents 放需要常驻的服务（来源: area）
- [新增常驻宿主服务时，必须同步] learning: 新增常驻宿主服务时，必须同步加进 packages/brain/src/launchd-patrol.js 的 manifest（来源: area）
- [单 slot 串行任务，并行] 一个 slot/会话内严格串行执行任务，同一 slot 同时只允许一个任务在跑；并行需用多个 slot/独立 session（来源: area）
- [禁止写死环境假设值] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done，未真验只能标 logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串，让隔离漏洞当场暴露（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [smoke-invarian] smoke 铁律（占位，无具体内容，来源: area）
- [smoke-invarian] smoke 铁律（占位，无具体内容，来源: area）
- [smoke-invarian] smoke 铁律（占位，无具体内容，来源: area）
- [smoke-invarian] smoke 铁律（占位，无具体内容，来源: area）
- [smoke-invarian] smoke 铁律（占位，无具体内容，来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/636a918c-8b23-4df5-baec-b1eb3308fffb/golden-paths 返回空数组 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空，proposer 按 target_environment=windows_cloud 在 GAN 阶段填入真实 Playwright/curl 脚本。期望验收点（自然语言）：

```bash
# 期望验收点：
# 1. curl GET /api/staff/line-health 返回 200，数组含 line01/line02/line04 三条，line01/line02 字段标 "not_connected" 而非 0/0 或报错
# 2. curl GET /api/staff/line-health/line04/deployment 返回非空 commit sha + 三环境状态
# 3. curl GET /api/staff/line-health/line04/abilities 返回 GP-A~F 六条 ability 及各自 thickness/status
# 4. Playwright: 打开 /line-health，等待 3 张卡片渲染，点击一张进入详情页，切换「部署」「能力」两个 tab，均渲染各自数据且互不阻塞
# 5. 构造 product-map.json 缺失场景，断言页面渲染兜底清单 + banner，而非白屏/报错
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/staff-hub 前端页面（总览页+详情页两个 tab），员工在浏览器中直接查看交互，非纯后端自动化任务
## target_environment: windows_cloud
## target_environment_reason: task payload 显式指定 target_environment=windows_cloud；且 ZenithJoy 任何 UI/Dashboard 均走该全局路由死规则，在 GitHub Actions windows-latest runner 上跑 Playwright E2E
## journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
## step_id: none（PrepPRD 未锚定，journey_feature `5e92525a-19a8-4ef6-b7a4-c7cf8aa9cd10` 的 step_id 字段当前为 null）
