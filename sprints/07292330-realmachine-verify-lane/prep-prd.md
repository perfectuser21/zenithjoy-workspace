# PrepPRD：真机验证车道 + 防假绿三层守卫 — 让"Golden Path smoke 绿"真的等于"客户能上线"

## 一句话背景（为什么建这个）

安卓 Path2 账号扫描的 `OPEN_PANEL_FAILED` 真机 bug 让客户上不了线,却卡了两三周没被发现——因为
`golden-path-2-smoke.sh` 里管这一步的断言(Step 30/31)是**把结果写死在自己发的请求里**的服务端
记账测试(curl 发一个 `error_code=OPEN_PANEL_FAILED` 的假 payload,再断言数据库记下了
`OPEN_PANEL_FAILED`),它永远不可能因为真机 bug 而报红。一个永远不会失败的测试等于没有测试。
本 sprint 建三层机制,让这种"假绿"结构上不再可能。

## 挂哪条 Journey / GP-Anchor

- **基建归属 Journey**：`工厂 · F3 夜间体检`（`ec4eb591-e064-4886-a7b6-4452cdf333d2`，autonomous，
  "到点→回归金字塔+三对账+晨报,早上知道昨晚红绿"）。三层的核心是每晚真机回归 + 防假绿守卫,
  性质是 dev_pipeline/夜间巡检,不是业务功能,归 F3 最贴切。而且 `nightly-real-machine-staging.yml`
  的注释里本就预留了"真安卓(Honor100)接入后(刀D)在此加 job"——这就是 F3 的空位,本 sprint 正是填它。
- **GP-Anchor（验证对象）**：`line02/customer_smart_acquisition#step7`——这三层第一个要保护的,
  就是客户智能获客路径(Path2)的 Step7(账号扫描/登录态检测)这条差点让客户上不了线的路。

## 现有基建盘点（本 sprint 大部分是"接线/扩展",不是从零造 —— 开工前先各读一遍防重复）

| 已有的东西 | 位置 | 本 sprint 怎么用它 |
|---|---|---|
| 夜间真机 workflow | `.github/workflows/nightly-real-machine-staging.yml`（北京03:00,`[self-hosted,wechat-capable]`=xian-rog,已跑真微信气泡门+真抖音读侧,红→自动开`[nightly-red]`issue） | 第2层在这里**加一个真安卓账号扫描 job**（注释预留的"刀D"位） |
| 真机采集 smoke | `.github/workflows/e2e-line02-android-collect.yml`（北京04:00,同 runner） + `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` | 第2层新脚本**照它的写法**（真机 adb + 触发 + 读结果 + 失败留证），不要另起一套风格 |
| CI 巡检员 | `ci-patrol` skill（已回答"哪些 golden path 进了CI但假绿",已有 guard 棘轮"硬伤数只降不升,升了开`[ci-patrol-red]`issue"） | 第1、3层**接进 ci-patrol 已有的假绿巡检 + 棘轮**,不新造巡检框架 |
| 本次真机验证的完整手动流程 | 见本 sprint 目录旁 `sprints/07290930-android-open-panel-failed-navigation-bug/`,以及本 Journey description 2026-07-29 进度段 | 第2层脚本**把这套手动流程固化**：install -r 最新APK→adb开无障碍→触发account-scan→轮询publish_tasks终态→断言读到真实账号 |

## Golden Path（开发者视角,单线性）

1. 开发者(或 nightly 定时)触发真机账号扫描验证 job → job 在 xian-rog 上 `install -r` 最新 APK(覆盖装,
   不卸载,保住注册态) → adb 用 `settings put` 开无障碍服务 → 系统:设备心跳上线、版本号=最新
2. job 脚本按 **hostname 型号 + 最新心跳**定位设备真实 agent_id(不写死旧 agent_id,重装后会变) →
   调 `POST /api/acquisition/account-scan/trigger` 拿 task_id → 系统:写入 publish_tasks
3. job 脚本轮询 `publish_tasks.status` + `response->>'error_code'` 终态 → 系统(设备端 DeviceAccountScanService)
   真实执行扫描并回写终态 → 下一状态:拿到 done / OPEN_PANEL_FAILED / MUTEX_BUSY / 超时 之一
4. job 断言 **`status='done'` 且 `account_ids` 非空(真读到账号)** → 绿;任何非 done → 红,自动开
   `[nightly-red]` issue,失败留 tree_dump 证据 → 出口:每晚都有一份"账号扫描这步真机到底通不通"的真实账本
5. **第1层**:任何 golden path smoke 里"用假 payload 顶替真机行为"的步骤,必须带 `# [CI-MOCK: real-device-only]`
   标记 → lint 守卫扫出"断言把结果写死在自己发的请求里"的自我实现假测试,漏标记 → CI 红
6. **第3层**:ci-patrol 每天统计"带 [CI-MOCK] 标记但没有对应 nightly 真机 job 覆盖的步骤数",这个数
   只降不升,升了自动开 issue → 任何 golden path 步骤想标 `done`,判据加硬约束:必须有 nightly 真机
   job 绿的证据链,不能只凭 mock smoke 绿

**错误路径**：xian-rog runner 掉线/设备离线 → job 标 infra-skip 而非绿(不能设备连不上就默认通过);
测试 license 配额被人工测试占满(免费版限1机) → 评估单独申一个多机位 license 给真机车道长期占槽,
不跟人工测试抢。

## 三层各自要交付什么（文件级）

### 第2层 · 真机验证车道（核心,最先做,这是缺失的那道闸）
- 新建 `.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh`：固化本次手动验证的整套。
  关键断言 = `publish_tasks.status='done'` 且 `account_ids` 非空(真读到账号),不是"服务器记账对不对"。
- 在 `nightly-real-machine-staging.yml` 加 job(刀D 预留位)：`runs-on: [self-hosted, wechat-capable]`,
  跑上面脚本,红 → `[nightly-red]` issue(复用现有机制)。
- 装包/授权/定位设备/注册凭据的细节全部脚本化(见 Golden Path Step 1-2),设备按 hostname 定位不写死 agent_id。

### 第1层 · 诚实标注 + lint 守卫
- 给所有 `golden-path-*-smoke.sh` 里"假 payload 顶替真机行为"的步骤加统一标记 `# [CI-MOCK: real-device-only]`。
- 新建 `.github/workflows/scripts/lint-smoke-mock-honesty.sh`：扫 smoke 脚本,揪出"同一段里 curl -d 带
  `error_code=X` 又断言 DB=`X`"这类自我实现的假测试;要求这类步骤必须带 `[CI-MOCK]` 标记,且该标记
  步骤必须能在某个 nightly 真机 job 里找到对应覆盖(否则报红)。接进 L1 Process Gate。

### 第3层 · 棘轮门禁（接 ci-patrol,不另造）
- 在 ci-patrol 的硬伤巡检里加一个指标:"未经真机验证的 golden path 步骤数"（= 带 [CI-MOCK] 但无
  对应 nightly 真机 job 覆盖的步骤）,纳入现有 guard 棘轮"只降不升,升了开 issue"。
- golden path 步骤标 `done` 的判据补硬约束:必须有 nightly 真机 job 绿的证据链。

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 真机 job 里"这步到底通没通" | ①只看 HTTP 200/接口有回 ②读 publish_tasks.status='done' 且 account_ids 非空 | ② | 本次真机复现证实:设备真执行了但可能失败(OPEN_PANEL_FAILED),只有终态+真实账号才是"真通了"的证据 | 若用①,又回到"服务器有回就算绿"的假绿老路,白建 |
| ⚠️ 设备/runner 连不上时算什么 | ①默认绿(连不上跳过) ②标 infra-skip,既不算绿也不算红 | ② | 设备连不上就默认通过 = 假绿的另一种形式;必须让"没验到"和"验过是绿"区分开 | 若用①,runner 一掉线就全绿,守卫形同虚设 |

## 前置工作（新 session 开工前必查）

- [ ] xian-rog self-hosted runner 在线且带 `wechat-capable` label（现有两个 nightly 真机 workflow 全靠它）：
      `gh api repos/perfectuser21/zenithjoy-workspace/actions/runners` 或看 nightly workflow 最近 run
- [ ] 测试设备可达 + 可 `install -r` + adb 可用（本次用的 MAA-AN00 序列号 ANGYVB4311010223,或换 ANY-AN00 小粉）
- [ ] 固定测试 license `ZJ-F-CLDCQNT6` 免费版限 1 机——真机车道要长期占 1 个槽,评估是否单独申一个多机位
      license,避免跟人工测试抢配额（本次为验证清过一次旧占用记录）
- [ ] 读一遍现有 `line02-android-collect-realmachine-smoke.sh` 作为脚本写法模板,别另起风格
- [ ] 读一遍 ci-patrol skill 的 guard 棘轮实现,确认第3层怎么接进去
- [ ] 确认设备身份系统的已知缺口（issue 已登记）:agent 心跳有 `last_seen` vs `last_heartbeat_at` 两套,
      trigger 接口只认 `last_heartbeat_at`——真机 job 触发前可能要显式更新这个字段,或先修那个底层不一致

## 验收标准（Final —— proven-to-fire 是灵魂,不是可选项）

这三层最容易白建的方式就是"写好了但从没见它报红过"。每一层都必须亲眼看它拦红过一次才算数:

- [ ] **第2层 proven-to-fire**：故意 revert 本次某个真机修复(如 PR#1555 关闭浮层后重查节点那段),
      跑真机 job → 必须报红 + 自动开 `[nightly-red]` issue。看到它红,再把 revert 撤回。
- [ ] **第1层 proven-to-fire**：故意给某个 golden path smoke 加一段"写死结果的假断言"、或删掉某个
      真机步骤的 `[CI-MOCK]` 标记 → `lint-smoke-mock-honesty` 必须报红。
- [ ] **第3层 proven-to-fire**：故意新增一个带 `[CI-MOCK]` 但没有 nightly 真机 job 覆盖的步骤 →
      ci-patrol 棘轮必须报红开 issue。
- [ ] 真机 job 首次真实跑通一次:account-scan 真机 smoke 在 xian-rog 上 `status=done` + 读到真实账号。
- [ ] `nightly-real-machine-staging.yml` 里能看到新 job,下一个夜间窗口自动跑。
- [ ] CI 全绿。

## 不包含（另立,别混进来）
- 修 agent 心跳 `last_seen`/`last_heartbeat_at` 双字段不一致的底层 bug（已登记 issue,单独处理）
- 给 Path2 补建 golden_path(303)/journey_features(kind=ability) 结构化记录（已登记 issue `cbe9ed30`,
  能力轴迁移遗留,单独评估）
- 真机 OTA 自更新能力（本 sprint 仍靠 job 主动 install -r,不做 agent 自升级）
