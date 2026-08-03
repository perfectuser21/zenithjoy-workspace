# Sprint PRD — Kernel acquisition effective-config guard v2 真实 Fleet 验证 r10

## OKR 对齐

- **对应 KR**：待定（Brain context 未返回活跃 KR）
- **当前进度**：待定
- **本次推进预期**：完成 PR #1581 指定 SHA 的独立新鲜验收，不以历史运行替代

## 背景

对 perfectuser21/zenithjoy-workspace PR #1581 的精确提交 `c305f6217da65bb69413c39e621b7e797e0fb189` 进行一次真实业务 Kernel Harness 验证。上一轮因 `remote_bridge_prepare_timeout` 失败，本轮以增量跨节点制品接力恢复，并要求合并前同时取得新鲜 Evaluator 与 Independent Judge 结论。

## Golden Path（核心场景）

系统从 PR #1581 的精确 SHA `c305f6217da65bb69413c39e621b7e797e0fb189` 进入 → 经过 provider-neutral 完整 pipeline 与增量跨节点制品接力 → 到达新鲜 Evaluator 和 Independent Judge 均通过、且所有结论锚定同一 SHA 的出口。

具体：

1. 调度方以冻结基线和目标 PR 精确 SHA 启动本次真实 Fleet 验证，并保持角色机器严格亲和。
2. 各阶段只消费本次运行逐节点新增并接力的制品；不得读取或复制其他候选，不得修改共享 red fixture。
3. 完整 provider-neutral pipeline 运行结束后，Evaluator 对目标 SHA 产生本次运行的新鲜判定。
4. Independent Judge 独立读取本次接力制品并对同一目标 SHA 产生新鲜判定。
5. 仅当 Evaluator 与 Independent Judge 均通过且 SHA 一致时，系统才允许进入人工复核后的合并候选状态；否则保持未合并并报告失败阶段。

## 边界情况

- 目标 PR 当前 head 与指定 SHA 不一致时立即失败，不允许改验更新后的 head。
- 跨节点制品缺失、重复、来源 run 不一致或不能锚定目标 SHA 时不得继续判绿。
- 任一角色未在 payload 指定机器执行，或发生未声明 fallback 时，本次验证无效。
- Evaluator 或 Independent Judge 缺失、非本次运行产生、结论不通过或 SHA 不一致时禁止合并。
- 远端 bridge 再次超时可报告失败，不得复用上一轮结论伪装成功。
- GitHub、Postgres 或模型 structured output 能力不可用时，输出明确阻断原因。

## 范围限定

**在范围内**：PR #1581 精确 SHA 的新鲜真实 Fleet 验证；完整 provider-neutral pipeline；增量跨节点制品接力；Evaluator 与 Independent Judge 双重结论；合并前人工复核门。

**不在范围内**：修改 PR #1581 的候选实现；验证其他 SHA；复用历史 Evaluator/Judge 结论；读取或复制其他候选；修改共享 red fixture；在双重判定前合并。

## 假设

- [ASSUMPTION: `gp_anchor=line02/keyword_acquisition#step7` 已将本 Sprint 锚定到 Line02 keyword_acquisition Step 7。]
- [ASSUMPTION: Brain context 未返回活跃 KR，因此 OKR 编号和进度留待 Proposer 补齐，不影响验收范围。]
- [ASSUMPTION: payload 明确给出的 `local_api` 是本轮编排与制品核验环境；真实 Fleet 角色仍按各自 strict-affinity machine 执行。]

## 预期受影响文件

- `sprints/08031923-kernel-pr1581-fleet-validation-r10/sprint-prd.md`：记录本轮范围、历史铁律与验收出口。
- 本次运行的增量跨节点制品：由各角色追加并传递，不修改 PR #1581 候选代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->

- 超时/延迟：全流程最长 7200 秒。
- 频控：待定（PrepPRD 未指定）。
- 版本要求：目标仓库 `perfectuser21/zenithjoy-workspace`；base SHA `b937e1d39a81c4a46d06a83a84886facb79d7ba2`；目标 head SHA `c305f6217da65bb69413c39e621b7e797e0fb189`；runner digest `sha256:e8979dcf7791b1fd0754276d39fd58adf9c8fc1148323a3d0d3b8abe29ea351f`。
- 可观测：每个阶段制品可追溯到本次 run、角色、目标 SHA 与执行机器；失败必须暴露阶段和原因。
- 安全：不得读取或复制其他候选，不得修改共享 red fixture，不得在独立判定前合并。
- 资源：GitHub、Postgres 与 structured output 能力均为必需。
- 决策副源：step 与 journey_feature NFR 均为空，未覆盖上述 PrepPRD 显式值。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 为空，area 共 62 条 -->

- [历史约束] cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在（来源: area）
- [历史约束] 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染（来源: area）
- [历史约束] proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area）
- [历史约束] contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）
- [历史约束] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [历史约束] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [历史约束] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [历史约束] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断（来源: area）
- [历史约束] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失（来源: area）
- [历史约束] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [历史约束] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [历史约束] smoke 铁律（来源: area）
- [历史约束] smoke 铁律（来源: area）
- [历史约束] [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测（来源: area）
- [历史约束] [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的（来源: area）
- [历史约束] [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测（来源: area）
- [历史约束] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [历史约束] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [历史约束] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [历史约束] [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工（来源: area）
- [历史约束] [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m（来源: area）
- [历史约束] [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（来源: area）
- [历史约束] smoke 铁律（来源: area）
- [历史约束] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [历史约束] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 （来源: area）
- [历史约束] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [历史约束] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub （来源: area）
- [历史约束] [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [历史约束] [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [历史约束] [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [历史约束] [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [历史约束] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [历史约束] [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [历史约束] [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [历史约束] [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子（来源: area）
- [历史约束] [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸（来源: area）
- [历史约束] [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [历史约束] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [历史约束] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [历史约束] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [历史约束] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [历史约束] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [历史约束] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [历史约束] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD（来源: area）
- [历史约束] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [历史约束] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享（来源: area）
- [历史约束] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合（来源: area）
- [历史约束] smoke 铁律（来源: area）
- [历史约束] [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [历史约束] [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re（来源: area）
- [历史约束] [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [历史约束] [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator（来源: area）
- [历史约束] [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE（来源: area）
- [历史约束] smoke 铁律（来源: area）
- [历史约束] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [历史约束] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [历史约束] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [历史约束] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [历史约束] secrets 不硬编码、不进 git、不进日志（来源: area）
- [历史约束] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [历史约束] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [历史约束] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->

- （本 line 暂无历史）

## E2E 验收

以下脚本作为 Proposer 可执行验收计划的输入；Evaluator/Judge 结果文件均须由本次 run 新鲜生成。

```bash
set -euo pipefail
TARGET_SHA='c305f6217da65bb69413c39e621b7e797e0fb189'
RUN_ID='1a4f324c-2300-410c-8e59-84cd8b4886fc'
: "${EVALUATOR_RESULT:?需提供本次 Evaluator JSON 路径}"
: "${JUDGE_RESULT:?需提供本次 Independent Judge JSON 路径}"

test "$(git rev-parse HEAD)" = "$TARGET_SHA"
for result in "$EVALUATOR_RESULT" "$JUDGE_RESULT"; do
  test -s "$result"
  jq -e --arg sha "$TARGET_SHA" --arg run "$RUN_ID" '
    (.status // .verdict) == "PASS"
    and (.sha // .head_sha // .target_sha) == $sha
    and (.run_id == $run)
  ' "$result" >/dev/null
done
test "$(jq -r '.sha // .head_sha // .target_sha' "$EVALUATOR_RESULT")" =      "$(jq -r '.sha // .head_sha // .target_sha' "$JUDGE_RESULT")"
echo "PASS: PR #1581 精确 SHA 的新鲜 Evaluator + Independent Judge 双验收成立"
```

## journey_type: autonomous
## journey_type_reason: 本 Sprint 验证纯后端 Kernel Harness 编排与制品接力，无用户界面交互。
## target_environment: local_api
## target_environment_reason: zenithjoy payload 显式指定 local_api；编排与制品核验在本地 evaluator 执行，Fleet 角色按 strict-affinity machine 分派。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7

