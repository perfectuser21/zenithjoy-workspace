# 设计：crontab 获客流水线补账本 + 阶段工件 + 断点续跑（基座 1/7）

task `b4b09cdd` · 决策 `adf7d620`（不需要 n8n）/ `01d0af0a`（路径 B）· GP-Anchor `line02/keyword_acquisition keep-green`
PrepPRD：`sprints/09212202-crontab-leadgen-ledger-artifacts/prep-prd.md`

## 目标

现有 crontab 流水线（`harvest-cron.sh → batch2.sh → harvest-keyword.sh → douyin-phone-adb`）是真正在出线索的编排器，但**无账本、无阶段工件、无合同哈希、无续跑**——看板员/熟化员/harness 都读不到它。本设计在**不改生产原文件**的前提下，用独立副本 `*-v4.sh` 把这四样补齐，工件形状与 `workflow-runs/` 既有约定、`protocol.md` 的 `WORKER_RESULT` 契约一致。escort 召唤/注销生产已有（`harvest-cron.sh` L44-56），本设计只加"真活复核 + 孤儿清扫"。

## 方案选择

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A 侧车写手（选）** | 新增 `workflow-result.sh`（bash，照 `wall-report.sh` 范式：永远退出 0）+ `ledger.mjs`（node，部署到 M4 `~/bin-harvest/`），在 v4 副本的 4 个钩子点调用；工件先落本地，收工 best-effort `scp` 到 MMV | 热循环内零网络依赖；完全沿用既有 `wr()` 旁路模式；改动面 4 处 |
| B 每阶段 ssh mmv 写账本 | 账本只在 MMV，每阶段 `ssh mmv node ledger.mjs set` | 每词 2 次 ssh，热循环里多一个网络失败面；否决 |
| C 流水线改写成 node | 一次到位 | 违背"小改动"与"shell 是永久形态"的实证结论；否决 |

## 组件（各一职责）

### 1 `ledger.mjs`（node，`services/phone-adb-controller/ledger.mjs`）
复用 zenithjoy-skills 仓 `android-douyin-leadgen-nextgen/scripts/ledger.mjs` 种子。
- 子命令：`init --run-dir D --run-id R [--hash H]` / `set --stage S --status completed|blocked|failed --summary "..." [--n K --word W]` / `show` / `next-attempt`
- `STAGES` 固定为 manifest 七阶段：`preflight discovery qualification collection scoring delivery cleanup`
- **账本扩展（种子没有，本任务加）**：`stages.discovery.items[{n, word, status, updated_at}]` 与 `stages.collection.items[...]`，由 `set --n K --word W` 写入；`next-attempt` 输出 `{attempt_id, skip_words[]}`，`skip_words` = discovery 且 collection 都 `completed` 的词。种子的 `next-attempt` 只导入 completed 阶段，不存每词结果，续跑必须靠这个扩展
- `attempt_id` 只在 `enter` 时递增（见 §2），`init` 不递增
- 账本文件：`~/.config/zenithjoy/ledger/<run_id>.json`（**不放 RAM 盘**）；JSON 损坏 → 当无账本（fail-open）
- 只做状态记录，不做判断

### 2 `workflow-result.sh`（bash 侧车，`services/phone-adb-controller/workflow-result.sh`）
`wfr init|enter|stage|finalize`，**永远 `exit 0`，绝不阻塞主流程**。
- `init`：算 `RUN_ID=social-keyword-leadgen-crontab-$TAG`；`HASH=sha256(profile|sorted(词单)|six_months|most_liked|unlimited|PUSH)`，**不含 TAG、不含 SERIAL**（hash 是请求身份，与设备无关；`SERIAL/HOSTKEY` 记进 run 元数据 `run_meta`）；导出 `WFR_RUN_ID WFR_HASH WFR_DIR`；账本 `init`（不递增 attempt）；写 `preflight` 工件；一次性写 `qualification`/`scoring` 两个 `status=blocked, summary=not_in_profile` 工件（诚实：crontab 路径不发生这两步）
- `enter`：仅在真正进入 batch2 前调用——`ledger next-attempt` 递增并导出 `WFR_ATTEMPT`（首次 a1）与 `skip_words`（续跑）。白天退让 / KPI 达标 / 空词单的 `exit 0` 都在 `enter` 之前，**不计 attempt**（主理人拍板 ②）
- `stage <stage> <status> <n> <summary> <evidence-json> <metrics-json>`：写 `<run_id>__<attempt>.<stage>.<n>.worker-result.json`，内容 `schema_version:2, run_id, attempt_id, stage_id, stage_attempt, task_request_hash, status, recommended_next_action, summary, evidence[], metrics{}`；`recommended_next_action ∈ accept|steer|retry|block|stop`（protocol.md L94-98；completed→accept，blocked→block，failed→retry）；写后 **`/usr/bin/jq -e` 校验**（schema_version=2 / completed 时 evidence≥1 / 该阶段闭集键全部为数字）——校验不过 = 视为未写成，记 warning（判定点 `544cd6a3`：判据用产物不用返回码）；写失败记录 **raw errno**，不只记"写失败"（防错误归因）
- **metrics 闭集键（protocol.md L78-85，每阶段必须全部出现，没发生填 0，禁自造）**：

| 阶段 | 通用 4 键之外的必填键 |
|---|---|
| preflight | `device_verified account_verified call_state_idle lock_acquired` |
| discovery | `candidates keywords_processed screens_scanned` |
| qualification | `candidates_judged qualified` |
| collection | `comments_collected videos_processed cursor_updates` |
| scoring | `comments_scored strong_intent weak_intent peer irrelevant spam` |
| delivery | `leads_written duplicates_skipped readback_verified cursor_updates` |
| cleanup | `close_app_attempts lock_released safe_desktop_visible` |

通用 4 键：`external_interactions business_reads business_writes artifact_writes`。scoring 的键集仍是旧口径（strong/weak），本任务只填 0，口径修正归基座 7/7。
- `finalize`：写 `cleanup` 工件；自检"本 run 工件数 == 已记账阶段数"，不等 → `escalate`；best-effort `scp` 本 run 全部工件到 MMV `workflow-runs/`（失败本地留，下批补）
- 本地工件目录：`~/.config/zenithjoy/workflow-runs/`
- `metrics` 只填闭集键（通用 4 键 `external_interactions business_reads business_writes artifact_writes` + 阶段键），没发生填 0，禁自造键

### 3 `harvest-cron-v4.sh`
在原 L44 escort 块前后与 L111/L139 处加 5 个钩子：
1. 起跑：清前批孤儿 `ssh mmv "openclaw cron list" | grep escort-$HOSTKEY-` → `cron rm`（记日志）
2. escort 拉起后 30s：`ssh mmv openclaw cron list` 精确匹配 `escort-$HOSTKEY-$TAG`；未命中 → `escalate "escort 拉起返回 id 但 cron list 未命中"`（判定点 `4f85a74d`）
3. 取词单后（原 L111）：`wfr init`（算 hash、写 preflight/qualification/scoring 工件；**不递增 attempt**——原 L131 空词单 `exit 0` 在其后，不能算一次尝试）
4. batch2 调用前（原 L139）：`wfr enter`（递增 attempt、拿 `skip_words`）；**续跑**：把 `skip_words` 从 `$WF` 过滤掉再传给 batch2（主理人拍板 ②：进入 batch2 才计 attempt）
5. `trap`：原 `escort_dismiss` 之后追加 `wfr finalize`（EXIT INT TERM）

### 4 `batch2-v4.sh`
每词循环：`harvest-keyword.sh` 返回后按出口码映射（判定点 `af061588`）：
- `0` 且本词有 `VIDEO` 行 → `discovery completed` + `collection completed`。metrics 按 §2 闭集表填全：discovery `candidates`=本词 VIDEO 行增量、`keywords_processed`=1、`screens_scanned`=0（现有脚本不吐屏数，如实填 0）；collection `comments_collected`=本词 LEAD 行增量、`videos_processed`=VIDEO 增量、`cursor_updates`=0。**增量 = 本词前后 `grep -c` 之差**（现有 batch2 L30/34 数的是累计值，不能直接用）
- `0` 且无 `VIDEO` 行 → `discovery blocked`（无卡片）
- `3` → `discovery blocked`（锁被占）
- `1` → `discovery failed`（open-search 失败）
`stage_attempt` = 词序号 `$n`。push 段之后：`delivery completed`（`leads_written`=推送条数，`duplicates_skipped`=0 或从 push 输出取）。
**hash 一致性**：每词开始前重算词单 hash，与 `WFR_HASH` 不一致 → 写 `discovery blocked summary=hash_mismatch` + `escalate` + **停**（fail-closed，PrepPRD 拍板）。

### 5 `harvest-keyword.sh`
**不改**。出口码契约已成立：`3` 锁被占（L26）、`1` open-search 失败（L30）、`0` 正常/无卡片。仅在 README 记契约。

### 6 部署与切换（不在本 PR 内执行，写进 README「部署三步」）
`scp ledger.mjs workflow-result.sh harvest-cron-v4.sh batch2-v4.sh → ~/bin-harvest/`；**影子跑 2 晚**（crontab 加一条 v4 到不同 TAG 前缀、`PUSH=0`）通过验收后，把 crontab 两行 `harvest-cron.sh` 指向 v4。manifest `orchestrator.type→commander` 与 n8n V4 `inactive` 属 zenithjoy-skills 仓 / hk-vps 外部动作，记入 handoff 的 next_steps。

## 数据流

```
harvest-cron-v4 起跑 ─清孤儿escort─ 拉起escort ─30s复核─ 取词单 ─wfr init(hash/preflight)─ wfr enter(attempt/skip_words 过滤)─▶ batch2-v4
  每词: harvest-keyword(不改) → 出口码 → wfr stage discovery/collection(n=词序)
  push 后: wfr stage delivery
  trap: escort_dismiss → wfr finalize(cleanup + 自检 + scp MMV)
账本 ~/.config/zenithjoy/ledger/<run_id>.json   工件 ~/.config/zenithjoy/workflow-runs/<run_id>__aN.<stage>.<n>.worker-result.json
```

## 错误处理（每处显式）

| 依赖 | 失败 | 处理 | open/closed |
|---|---|---|---|
| 账本/工件写 | 目录不可写/盘满 | warning + raw errno，继续采收 | open |
| jq 校验 | 工件形状不合法 | 视为未写成，warning | open |
| escort 拉起/复核 | 网关不通 / 未命中 | 已有 3 重试 → escalate → 继续 | open |
| escort 注销 | kill -9 trap 不触发 | 下批起跑清孤儿 | open |
| **hash 不一致** | 词单中途被改 | blocked 工件 + escalate + **停** | **closed** |
| 坏账本 | JSON 损坏 | 当无账本，a1 重跑（去重兜底） | open |
| scp MMV | 失败 | 本地留，下批 finalize 补传未传的 | open |
| RAM 盘满 | mkdir 失败 | 失败记录含 errno 原文 | — |

## 测试策略（四档）

| 档 | 内容 | 在哪跑 |
|---|---|---|
| **unit** | `__tests__/workflow-result.test.mjs`：hash 同词单不同 TAG 相同、改一词即变、词单顺序无关；工件 JSON 形状（schema_version=2、completed 必有 evidence、metrics 闭集）；`__tests__/ledger-resume.test.mjs`：`next-attempt` 跳过 completed 词、attempt 递增、坏 JSON 当无账本 | CI L3 `node --test services/phone-adb-controller/__tests__/*.test.mjs`（已接） |
| **integration** | 本地跑 `batch2-v4.sh` 接一个假 `harvest-keyword.sh`（按参数返回 0/1/3 与固定 LEAD/VIDEO 行），断言账本 7 阶段状态、每词 items、工件数、出口码→status 映射、hash_mismatch 停跑、`enter` 前退出不计 attempt | 新增 `__tests__/pipeline-v4-integration.test.mjs`（spawn zsh）。**CI 是 ubuntu-latest，镜像无 zsh**：该测试在 CI job 里先 `sudo apt-get install -y zsh`，找不到 zsh 时 `t.skip`（不假绿） |
| **E2E** | xian-m4 影子跑 2 晚（`PUSH=0`）：账本 5 completed + 2 not_in_profile；工件含 hash；MMV `escort-findings` 当晚新写入 + 30s 复核命中；LEAD ≥ 近 7 天均值 | 人工触发，证据（账本/工件/日志）附 PR |
| **trivial** | 新增 grep 一律 `\|\| true` 再判；CI `lint-smoke-mock-honesty` | CI |

## 守卫（proven-to-fire，标 done 前各弄坏一次）

| 接缝 | 守卫 | 弄坏法 |
|---|---|---|
| WORKER_RESULT 形状 | unit test | 手写缺 evidence 的 completed 工件 → 红 |
| hash | unit test | 改一词 → 红 |
| pipefail 假绿 | `lint-smoke-mock-honesty` | 写 `grep -c \| head` → 红 |
| escort 真活（环境） | 30s 复核 → escalate | 手动 `cron rm` → escalation.log 出现 |
| 工件落地（环境） | finalize 自检 → escalate | 起跑前 `chmod 000` 工件目录 → escalate |
| 孤儿 escort（环境） | 起跑清扫 | 留一条假 escort → 被清并记日志 |

## 不包含
`douyin-phone-adb` / `outreach-tick.sh` / `push-*.js` / `harvest-keyword.sh` 一字不动；不切生产 crontab；manifest 切型与 n8n 停用另做；scoring 闭集键的口径（strong/weak）修正归基座 7/7；`decisions/match` 端点疑似有写库副作用（审批时观察到），范围外记入 handoff。

## 判定点（已入 decisions）
`9b2f5c67` 夜批算跑完=账本 cleanup=completed ⚠️ · `4f85a74d` escort 真活=cron list 命中+findings 新增 · `544cd6a3` 工件写成功=文件在且 jq 过 · `af061588` blocked/failed 按出口码映射 ⚠️
