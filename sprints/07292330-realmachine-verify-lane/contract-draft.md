# Sprint Contract Draft (Round 1)

## 已知约束（来源: 回归测试 grep + 累积FR + repo 现状排查）

- `context-manifest: unavailable`（journey_id ec4eb591 查询返回空数组，PRD 已注明"该 Journey 下第一个正式 ability"，无累积 FR）
- `[累积FR]` 无（同上）
- `.github/workflows/scripts/lint-smoke-baseline.sh` Rule 1：任何新增 `*-smoke.sh` 必须加入 `smoke-baseline.txt`，**或**加入 `.github/workflows/ci-smoke-glob-runner.yml` 的 `DENYLIST`（真机 smoke，ubuntu glob runner 跑不了的豁免名单，`line02-android-collect-realmachine-smoke.sh` 已是先例）。`account-scan-realmachine-smoke.sh` 依赖真实 Android 设备，必须走 DENYLIST，不进 baseline——漏做此项会导致 lint-smoke-baseline.sh 在 PR 上直接 FAIL。
- `scripts/product-map/lib.mjs` 现有 `computeGpSmokeRatchet` 导出模式（纯函数，输入已解析对象，不做文件 I/O）→ 本 sprint 新指标函数 `computeRealmachineUnverifiedRatchet` 跟进同款：纯函数 + `node --test`（原生 test runner，非 vitest——`package.json` 的 `test:product-map` 脚本固定用 `node --test <显式文件列表>`，非 glob，本 sprint 新测试文件必须显式加入该文件列表，否则 CI 不会跑到）。
- `.github/workflows/scripts/__tests__/lint-no-fake-test.test.sh` 现有 bash 测试壳模式（`run_case` 辅助函数 + 临时 git repo/目录构造 fixture + 断言 exit code）→ 本 sprint `lint-smoke-mock-honesty.sh` 的测试跟进同款 bash 测试文件，不用 vitest（lint 脚本本身是 bash，不是 JS 函数，无 TS/JS 可导入测试）。
- `apps/api/src/routes/agent-burner.ts` `POST /account-scan-result`（已存在，本 sprint 不改）：`taskFound` 时把 `publish_tasks` 推进到 `done`/`failed` 终态，`response` 字段写 `{ok, account_ids, error_code, screenshot_b64, tree_dump}`——真机 smoke 的终态断言字段来源于此，字面复用，不改字段名。
- `apps/api/src/routes/acquisition.ts` `POST /account-scan/trigger`（已存在，本 sprint 不改）：60 秒/租户限流（`accountScanTriggerRateLimit`），要求在线 android agent（`capabilities @> ARRAY['android']` 且 `last_heartbeat_at > now() - interval '2 minutes'`）；无在线设备返回 `400 NO_ONLINE_ANDROID_AGENT`。真机 smoke 每次运行只触发一次，不重试触发（避免打满限流）。
- `.github/workflows/scripts/smoke/android-onboarding-smoke.sh` 已验证的 `GET /api/agent/install-pack/android` 返回 `{apk_url, deeplink}`，`apk_url` 走自定义域名可真实下载——真机 smoke 的"安装最新 APK"步骤复用该端点，不新建下载通道。
- `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` 现有真机脚本约定（本 sprint 直接复用的模式）：`ok()`/`fail()`(exit 1，真验证失败)/`envfail()`(exit 3，环境未就绪) 三态区分；设备唤醒/复位手法（`input keyevent KEYCODE_WAKEUP`、`monkey -p <pkg> -c android.intent.category.LAUNCHER 1`）；无障碍开启断言 `settings get secure enabled_accessibility_services`。
- `.github/workflows/nightly-real-machine-staging.yml` 现有 `nightly-report` 汇总 job（`needs: [wechat-bubble, douyin-read]`, `if: always()`）已内置"红→自动开 `[nightly-red]` issue，同日去重"逻辑——刀D 只需把新 job 加进 `needs` 列表 + 汇总表新增一行 + 失败条件加一个 `||` 分支，禁止重新发明开 issue 的逻辑（精简纪律：复用已存在的收尾机制）。
- **`realmachine-unverified-ratchet.mjs` 测试期覆盖环境变量 SSOT（round 2 修订，回应 GAN round 1 内部一致问题）**：该 CLI 唯一支持的两个环境变量名为 `REALMACHINE_SMOKE_DIR`（覆盖扫描的 smoke 脚本目录，默认 `.github/workflows/scripts/smoke`）与 `REALMACHINE_NIGHTLY_YML`（覆盖读取的 nightly workflow 文件路径，默认 `.github/workflows/nightly-real-machine-staging.yml`）——两者各自独立可覆盖，未设置时使用默认值。合同全文（Golden Path Step 6、final-e2e 脚本、contract-dod.md 全部 BEHAVIOR 条目）必须统一使用这两个变量名，禁止出现 `SMOKE_DIR_OVERRIDE` 等其他命名（round 1 曾出现过命名分裂，已修）。

## 禁 mock 边清单

（本单不涉及 Brain 调度/状态机/跨模块运行时数据传递/生命周期钩子/DB 写路径——全部是新增 CI 脚本（bash + mjs 纯函数）+ 对已有只读端点/表的查询 + GitHub Actions YAML 配置改动，不改写任何已有服务端代码路径，N/A）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 三层机制：①真机验证车道（account-scan-realmachine-smoke.sh + nightly 刀D job）②诚实标注 + lint 守卫（[CI-MOCK] 标记 + lint-smoke-mock-honesty.sh）③ci-patrol 棘轮（未经真机验证步骤数指标） | 见 Golden Path |
| **NFR（做得多好）** | 轮询超时/间隔无 PRD 数值，proposer 定义合理默认 | account-scan-realmachine-smoke.sh 轮询：`POLL_MAX=18` × `POLL_INTERVAL=10s`（3 分钟预算，参照 line02-android-collect-realmachine-smoke.sh 同量级真机 UIA 操作耗时）；lint/ratchet 脚本 CI 内单次执行 < 30s |
| **Invariant（永不违反）** | 见 PRD Invariant 段，逐条映射见下方 DoD INV 条目 | 见 contract-dod.md `## Invariant 覆盖` |
| **判定点（怎么知道）** | 见下方登记表 | 见下方登记表 |
| **保质期（何时过期）** | `[CI-MOCK]` 标记与 `nightly_ref` 指向关系需在被标注脚本或 nightly job 改名/删除时同步更新，否则 ratchet 会误报"未覆盖" | 无自动过期机制，本 sprint 不解决（PRD 未要求），ci-patrol 每日巡检天然会重新计算，不存在陈旧值累积 |
| **死亡告警（停了谁知道）** | nightly 刀D job 失败→已有 `[nightly-red]` issue 机制通知；ci-patrol 棘轮升→已有 `[ci-patrol-red]` issue 机制通知 | 复用两条现成告警通道，不新建 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明表 | 见下方 |
| **效果确认（已发≠已生效）** | nightly 刀D job 每晚北京 03:00 自动跑，跑完在 GITHUB_STEP_SUMMARY + 汇总表可见；lint/ratchet 在每个 PR 的 CI 状态页可见 | 两处均为 GitHub Actions 原生可见性，不新建额外确认通道 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ golden-path-*-smoke.sh 里哪些步骤属于"用假 payload 顶替真机行为"需要标 `[CI-MOCK]` | A. 全量人工审查逐条打标；B. lint 脚本按"POST 到 `*-result` 端点且 `-d` payload 里硬编码 `error_code`/`ok` 字面值，且断言语句读回同一字面值"的模式自动识别，未命中此模式的步骤视为"非该类假测试，不强制标注" | B（lint-smoke-mock-honesty.sh 的检测规则，见下）| A 覆盖不了未来新增步骤（新 PR 加的假测试不会被回溯审查）；B 是可重复执行的机械判据，与 PRD 给出的 Step30 具体反例（curl 发 `error_code=OPEN_PANEL_FAILED` 假 payload 再断言库里存的还是这个值）完全对应 | 误判后果中等：规则过宽会误伤真实断言（如确实验证了服务端正确接受某 error_code 参数的用例），过窄会漏放真正的自我实现假测试——已在合同的 proven-to-fire BEHAVIOR 里正反各验一次，且允许 `# gate-allow` 式豁免注释供人工白名单个别误判 |
| 设备真实 `agent_id` 定位（hostname 型号 + 最新心跳） | A. adb logcat 抓 `agent started — agentId=` 日志行（line02-android-collect-realmachine-smoke.sh 既有模式）；B. 按 hostname 型号前缀 + `last_heartbeat_at` 最新排序查 DB（PRD Golden Path 第 2 步字面要求） | B（PRD 字面指定），但脚本按 A 的方式做**兜底**：DB 查询查无匹配时退化用 logcat 兜底定位，两者都失败才 `envfail` | PRD Golden Path 第 2 步明确写"按 hostname 型号+最新心跳定位"，且已知 `last_heartbeat_at`/`last_seen` 双字段不一致是登记在案的独立 issue（不阻塞本 sprint），单一依赖 DB 查询有失败风险，加 logcat 兜底防止该已知缺陷直接堵死本 sprint 的真机验证车道 | ⚠️ 高：定位到错误 agent_id 会导致 trigger 派给错误设备或 400 NO_ONLINE_ANDROID_AGENT，整条真机车道假死；已用双重定位 + envfail 兜底降低风险，`judgment-pending-user: 设备定位策略首跑校准` |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| xian-rog runner 掉线/无 Android 设备在线 | `account-scan-realmachine-smoke.sh` 走 `envfail()`，exit 3，日志前缀区分"环境未就绪" | 否（nightly 每晚自动重跑一次即为"重试"） | 标 `infra-skip`：`nightly-report` 汇总表标注该行 `infra-skip`，不计入绿/红判定（PRD 边界情况显式要求）；结果仍会被记录，不静默吞掉 |
| account-scan 真实终态非 `done`（`OPEN_PANEL_FAILED`/`MUTEX_BUSY`/超时） | `fail()`，exit 1，打印真实终态 | 否（真机 bug，需要人修，不是瞬时噪音） | `nightly-report` job 红，自动开 `[nightly-red]` issue（复用现成机制），失败留证据（`response` JSON 打印进 job log） |
| `lint-smoke-mock-honesty.sh` 命中未标注的假测试步骤 | PR CI 红，exit 1，打印 `file:line` | 否（需要人补标记或改写断言） | 无降级，阻塞合并（L1 Process Gate 硬闸） |
| ci-patrol `realmachine_unverified_count` 较昨日上升 | report-only，不阻塞 CI；ci-patrol 日报写入 + 棘轮升开 `[ci-patrol-red]` issue（复用现成机制） | N/A（棘轮语义，只读比较） | 不阻塞任何 PR，与现有 `gp_no_smoke_count`/`debt_count` 棘轮同等对待 |
| 测试 license（`ZJ-F-CLDCQNT6`）被人工测试占满 | `account-scan/trigger` 返回 `400 NO_ONLINE_ANDROID_AGENT`（设备被占无法响应心跳）或设备本身响应变慢 | 是（下个 nightly 窗口重跑） | PRD 边界情况显式声明"本 sprint 不解决配额分配"，脚本按正常 `fail`/`envfail` 分级处理，不额外识别"被占用" |

### 输入对抗面

（本 sprint 不涉及对外暴露 agent / 客服 agent / 外部用户可写入接口，全部是内部 CI 脚本 + 复用已有内部服务端点，N/A）

## 真实链路四硬规则自查

- **规则A（真实调用方 shape）**：本 sprint 不新增任何服务端端点，复用已存在的 `POST /account-scan/trigger`（Dashboard/脚本手动触发）与设备侧已实现的 `POST /account-scan-result` 上报——两者的请求 shape 均已在生产代码固化（见"已知约束"引用行号），N/A，无需新写 shape 段。
- **规则B（第三方真调一次）**：本 sprint 无第三方 API 依赖（不涉及 LLM/支付/短信/平台发布 API），N/A。
- **规则C（mock 豁免显式登记）**：见下方"未覆盖真实链路清单"。
- **规则D（target_environment 强制路由）**：`target_environment=windows_wechat`——xian-rog 是当前唯一同时具备 Android 真机 + self-hosted 标签 `wechat-capable` 的 runner（`line02-android-collect-realmachine-smoke.sh`/`e2e-line02-android-collect.yml` 已验证同款路由），本 sprint 沿用同一 runner，无需新建 android 专属 label。

## 未覆盖真实链路清单

- **PRD E2E 验收点①字面要求的"故意 revert 一个真机修复后重跑必须报红"**：本合同的 final-e2e（见下方 `## E2E 验收`）用**强制触发真实错误路径**替代"revert 历史修复提交"——通过 `adb shell settings put secure enabled_accessibility_services ''` 真实关闭无障碍服务，制造真实的 `OPEN_PANEL_FAILED` 终态，验证 `account-scan-realmachine-smoke.sh` 确实会因此报红（exit 1），随后恢复无障碍服务验证重新变绿。这是真实报红机制的验证，但不是"revert 一个历史 bug 修复"这个字面场景本身（当前没有可 revert 的历史真机修复提交可用）。真验证补位计划：下次该真机车道抓到一个真实回归时，`[nightly-red]` issue 本身即是"revert 验证过网"的证据留痕，不需要额外补测试。
- **Mode A（evaluator 非 xian-rog 环境，如 ubuntu-latest）无法真实持有 Android 设备**：`account-scan-realmachine-smoke.sh` 在 Mode A 环境下唯一可验证路径是 `envfail()`（exit 3，因为 `adb devices` 无设备）——这是诚实的环境降级，不是 mock（脚本没有伪造设备存在）。真实"设备在线 → 触发 → 轮询 → done + account_ids 非空"全链路只能在 windows_wechat（xian-rog）的 final-e2e 验证，Mode A 不重复验证同一件事。
- **lint-smoke-mock-honesty.sh 的 proven-to-fire 测试用合成 fixture 脚本（非真实 golden-path 文件）**：这不是对被测行为的 mock——lint 工具的职责就是扫描任意 smoke 脚本文本，fixture 是其正常输入域（同 `lint-no-fake-test.test.sh` 现有测试模式），并非绕过真实检测逻辑，故不计入豁免范围，仅在此注明避免被误判为规则C命中项。

## Golden Path

[nightly 刀D job 触发 / PR 提交] → [Step1: 真机安装+开无障碍] → [Step2: 定位设备+触发扫描] → [Step3: 轮询终态] → [Step4: 断言done+账号非空/失败留证据] → [Step5: 假payload诚实标注+lint守卫] → [Step6: ci-patrol棘轮接线] → [出口: 每晚真实账本 + PR级防假绿双闸]

### Step 1: 真机安装最新 APK + 开无障碍服务
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条："job 在 xian-rog 上 `install -r` 最新 APK（覆盖装，不卸载，保住注册态）→ adb 用 `settings put` 开无障碍服务"

**可观测行为**: xian-rog 真机上运行 `account-scan-realmachine-smoke.sh` 后，设备上安装的是最新 APK（版本号可读），无障碍服务已开启（`enabled_accessibility_services` 含 agent 包名）。

**验证命令**（final-e2e 在 xian-rog 上执行，见 `## E2E 验收`）：
```bash
adb shell dumpsys package com.zenithjoy.agent | grep -oE 'versionName=[^ ]+'
adb shell settings get secure enabled_accessibility_services | grep -q com.zenithjoy.agent
```

**硬阈值**: `adb install -r` exit 0；无障碍服务 grep 命中，5 秒内确认。

---

### Step 2: 动态定位设备真实 agent_id + 触发账号扫描
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条："job 脚本按 hostname 型号 + 最新心跳定位设备真实 agent_id（不写死旧 id）→ 调 `POST /api/acquisition/account-scan/trigger` 拿 task_id → 系统写入 publish_tasks"

**可观测行为**: `account-scan/trigger` 返回 `{success:true, data:{task_id:<uuid>}}`，`zenithjoy.publish_tasks` 新增一行 `task_type='account_scan', status='queued'`。

**验证命令**:
```bash
RESP=$(curl -fsSk -m 15 -X POST "$API_BASE/api/acquisition/account-scan/trigger" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT")
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]
```

**硬阈值**: HTTP 200，`task_id` 为合法 UUID，15 秒内响应。

---

### Step 3: 轮询 publish_tasks 终态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条："job 脚本轮询 `publish_tasks.status` + `response->>'error_code'` 终态 → 拿到 done / OPEN_PANEL_FAILED / MUTEX_BUSY / 超时 之一"

**可观测行为**: 脚本每 10 秒查一次 `publish_tasks` 该行 `status`+`response`，直到 `status` 变为 `done`/`failed` 或达到 `POLL_MAX=18` 次（3 分钟）超时才跳出循环。**轮询循环只在 `STATUS='done'` 时才跳出并进入 Step 4 的 account_ids 检查；`STATUS` 为其他终态（`failed`/超时视为等价 failed）时，脚本直接判该次运行为红（`fail()`，exit 1），不进入 Step 4 的 account_ids 检查分支**——这是防止"仅凭 account_ids 非空就判绿"退化的第一道防线（本 sprint 要修复的原始 bug 模式）。

**验证命令**:
```bash
ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -F'|' -c \
  \"SELECT status, response FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'\"")
STATUS="${ROW%%|*}"
```

**硬阈值**: 3 分钟内拿到终态之一（done/failed），否则判超时（等价 failed 分支，不进入 Step 4）。

---

### Step 4: 断言终态 + 失败留证据
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条："job 断言 `status='done'` 且 `account_ids` 非空（真读到账号）→ 绿；任何非 done → 红，自动开 `[nightly-red]` issue，失败留证据 → 出口：每晚一份真实账本"

**可观测行为**: `status='done'` **且** `response->'account_ids'` 是非空数组 → 脚本 exit 0；`status` 非 `done`（即使 `response->'account_ids'` 恰好非空——脏数据/上次运行残留）→ 脚本仍必须 exit 1 并打印 `response` 全文（含 `error_code`/`screenshot_b64` 供排查）。`nightly-report` job 汇总该结果，红时开 `[nightly-red]` issue（复用现成逻辑，仅扩展 `needs`/汇总表/失败条件）。

**两段式判据不可拆分**：这是 PRD 原文用粗体强调的核心断言，禁止退化成"只要 account_ids 读到就算过"（即 Step30 历史 bug 的翻版：字段读到就算过）。为使该联合断言可被独立回归测试覆盖（不依赖真机/真 SSH），`account-scan-realmachine-smoke.sh` 必须把判定逻辑抽成一个纯 bash 函数 `assert_task_terminal_success STATUS RESPONSE_JSON`（返回 0=真通过，1=判红），脚本用 `[ "${BASH_SOURCE[0]}" = "${0}" ] && main "$@"` 守卫，使该函数可被 `source` 后直接单独调用（不触发真机主流程）——见 `contract-dod.md` 对应 `[ARTIFACT]`/`[BEHAVIOR]` 条目。

**验证命令**:
```bash
ROW=$(ssh "$DB_SSH_HOST" "docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -tA -F'|' -c \
  \"SELECT status, response FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'\"")
STATUS="${ROW%%|*}"; RESP="${ROW#*|}"
source .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh --source-only
assert_task_terminal_success "$STATUS" "$RESP"
```

**硬阈值**: `status='done'` AND `account_ids` 数组长度 ≥ 1（联合断言，`assert_task_terminal_success` 内部先判 `STATUS`，非 `done` 直接返回 1，不看 `account_ids`）。

---

### Step 5: 假 payload 诚实标注 + lint 守卫
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条："所有 `golden-path-*-smoke.sh` 里'用假 payload 顶替真机行为'的步骤必须带 `# [CI-MOCK: real-device-only]` 标记 → 新建 `lint-smoke-mock-honesty.sh` 扫出自我实现假测试，漏标记 → CI 红"

**可观测行为**: `lint-smoke-mock-honesty.sh` 对含"POST 到 `*-result` 端点且 `-d` payload 硬编码 `error_code`/`ok` 字面值、随后断言读回同一字面值"模式、但缺 `# [CI-MOCK: real-device-only | nightly_ref: <script>]` 标记的步骤报错退出非 0；带标记的放行。标记格式：`# [CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]`，写在假测试步骤前 5 行内。

**验证命令**:
```bash
bash .github/workflows/scripts/lint-smoke-mock-honesty.sh .github/workflows/scripts/smoke
```

**硬阈值**: 对当前仓库全部 `golden-path-*-smoke.sh`（含已加标记的 `golden-path-2-smoke.sh` Step 30）exit 0；对故意漏标记的 fixture exit 非 0。

---

### Step 6: ci-patrol 棘轮接入"未经真机验证步骤数"
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条："ci-patrol 每日统计'带 [CI-MOCK] 但无对应 nightly 真机 job 覆盖的步骤数'，纳入现有 guard 棘轮（只降不升，升了开 issue）"

**可观测行为**: 新建 `scripts/product-map/realmachine-unverified-ratchet.mjs`（跟进 `gp-smoke-ratchet.mjs` report-only 模式），扫描 `golden-path-*-smoke.sh` 里的 `[CI-MOCK: real-device-only | nightly_ref: X]` 标记，检查 `nightly_ref` 指向的脚本名是否在 `nightly-real-machine-staging.yml` 中被引用；未被引用（或标记缺 `nightly_ref`）计入 `realmachine_unverified_count`。输出 JSON `{realmachine_unverified_count, realmachine_unverified_ids}`，stdout，exit 恒 0（report-only，不作 CI 硬闸——与 `gp-smoke-ratchet.mjs` 同款定位）。

> **范围边界（本 sprint 明确不做）**：ci-patrol SKILL.md 本体的"数据源⑧接线"文本编辑不在本 repo（zenithjoy-workspace）范围内——SKILL.md 的 SSOT 是独立的 `zenithjoy-skills` 仓库（见项目已知约定），本 sprint 只交付 `zenithjoy-workspace` 内可被该 skill 消费的脚本产物（`realmachine-unverified-ratchet.mjs` + npm script），skill 侧文本接线走另一个针对 `zenithjoy-skills` 仓库的独立任务。这与 PRD"预期受影响文件"只列出"ci-patrol skill 相关**巡检脚本**"（未列 SKILL.md 本身）一致。

**验证命令**:
```bash
node scripts/product-map/realmachine-unverified-ratchet.mjs | jq -e '.realmachine_unverified_count >= 0'
```

**硬阈值**: 脚本 exit 0，输出合法 JSON，字段类型正确；对当前仓库真实状态（Step 5 已加全标记 + Step 1 已加 nightly 刀D job）跑出 `realmachine_unverified_count = 0`。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: windows_wechat（xian-rog self-hosted runner，`wechat-capable` 标签，同时承载 Android 真机；`line02-android-collect-realmachine-smoke.sh` 已验证同款路由）

> 本 E2E 脚本覆盖 PRD 原文列出的全部 4 个验收点：①真机车道首次真实跑通 + 强制报红再复绿（proven-to-fire 替代"revert"，见"未覆盖真实链路清单"）②lint-smoke-mock-honesty.sh 对漏标记/删标记报红 ③ci-patrol 棘轮对新增未覆盖步骤报红（计数上升）④nightly-real-machine-staging.yml 可见新 job。

```bash
#!/bin/bash
set -uo pipefail
FAIL=0

ADB=$(ls "/c/Users/asus/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_"*/scrcpy-*/adb.exe 2>/dev/null | head -1)
[ -n "$ADB" ] || ADB=$(command -v adb 2>/dev/null || true)
[ -n "$ADB" ] || { echo "🟠 环境未就绪: 找不到 adb，final-e2e 无法在此 runner 验证"; exit 3; }

API_BASE="${API_BASE:-https://staging-autopilot.zenjoymedia.media}"
TENANT="${SMOKE_TENANT:-455a8ca9-5f63-4286-83ce-c5cca04cfd58}"
DB_SSH_HOST="${DB_SSH_HOST:-hk-vps}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "① 真机车道首次跑通（happy path）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh
HAPPY_CODE=$?
[ "$HAPPY_CODE" -eq 0 ] || { echo "❌ FAIL: 真机 happy path 首跑未通过 exit=$HAPPY_CODE"; FAIL=1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "①b proven-to-fire：强制关闭无障碍服务制造真实 OPEN_PANEL_FAILED，验证脚本真的会报红"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ORIG_ACC=$("$ADB" shell settings get secure enabled_accessibility_services 2>/dev/null)
"$ADB" shell settings put secure enabled_accessibility_services '' >/dev/null 2>&1
sleep 2
set +e
bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh
RED_CODE=$?
set -e
"$ADB" shell settings put secure enabled_accessibility_services "$ORIG_ACC" >/dev/null 2>&1
sleep 2
[ "$RED_CODE" -eq 1 ] || { echo "❌ FAIL: 强制关闭无障碍后期望脚本报红(exit 1)，实得 exit=$RED_CODE —— proven-to-fire 未验证到"; FAIL=1; }
echo "✅ 强制故障路径确认报红 exit=$RED_CODE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "①c 恢复无障碍后重新验证变绿（防止②只测了红没测回绿）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh
RECOVER_CODE=$?
[ "$RECOVER_CODE" -eq 0 ] || { echo "❌ FAIL: 恢复无障碍后期望重新变绿，实得 exit=$RECOVER_CODE"; FAIL=1; }
echo "✅ 恢复后重新变绿 exit=$RECOVER_CODE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "② lint-smoke-mock-honesty.sh 对漏标记报红 + 对真实仓库现状报绿"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
FIXDIR=$(mktemp -d)
cat > "$FIXDIR/golden-path-99-smoke.sh" <<'FIXEOF'
#!/usr/bin/env bash
echo "▶ Step 1: 假测试(故意漏标记)"
S1_RESP=$(curl -fsSk -X POST "$API_BASE/account-scan-result" -d '{"agent_id":"x","request_id":"y","ok":false,"error_code":"OPEN_PANEL_FAILED"}')
S1_ROW=$(psql "$DB" -tA -c "SELECT error_code FROM zenithjoy.agent_scan_failures WHERE request_id='y'")
[ "$S1_ROW" = "OPEN_PANEL_FAILED" ] || exit 1
FIXEOF
set +e
bash .github/workflows/scripts/lint-smoke-mock-honesty.sh "$FIXDIR"
LINT_BAD_CODE=$?
set -e
[ "$LINT_BAD_CODE" -ne 0 ] || { echo "❌ FAIL: 漏标记 fixture 未被 lint 抓到"; FAIL=1; }
echo "✅ 漏标记 fixture 正确报红 exit=$LINT_BAD_CODE"

sed -i.bak '2a # [CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]' "$FIXDIR/golden-path-99-smoke.sh"
bash .github/workflows/scripts/lint-smoke-mock-honesty.sh "$FIXDIR"
LINT_GOOD_CODE=$?
[ "$LINT_GOOD_CODE" -eq 0 ] || { echo "❌ FAIL: 补标记后期望通过，实得 exit=$LINT_GOOD_CODE"; FAIL=1; }
echo "✅ 补标记后通过 exit=$LINT_GOOD_CODE"
rm -rf "$FIXDIR"

bash .github/workflows/scripts/lint-smoke-mock-honesty.sh .github/workflows/scripts/smoke
[ $? -eq 0 ] || { echo "❌ FAIL: 真实仓库现状（含已加标记的 golden-path-2-smoke.sh）应通过"; FAIL=1; }
echo "✅ 真实仓库现状通过"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "③ ci-patrol 棘轮：新增未覆盖步骤 → 计数上升"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
BASELINE_JSON=$(node scripts/product-map/realmachine-unverified-ratchet.mjs)
BASELINE_COUNT=$(echo "$BASELINE_JSON" | jq -r '.realmachine_unverified_count')

TMPSMOKE="/tmp/rm-ratchet-e2e-fixture-smoke"
mkdir -p "$TMPSMOKE"
cp .github/workflows/scripts/smoke/golden-path-2-smoke.sh "$TMPSMOKE/" 2>/dev/null || true
cat > "$TMPSMOKE/golden-path-98-smoke.sh" <<'FIXEOF2'
# [CI-MOCK: real-device-only | nightly_ref: nonexistent-job-not-in-nightly.sh]
echo "占位：nightly_ref 指向的脚本不存在于 nightly-real-machine-staging.yml"
FIXEOF2
AFTER_JSON=$(REALMACHINE_SMOKE_DIR="$TMPSMOKE" REALMACHINE_NIGHTLY_YML=.github/workflows/nightly-real-machine-staging.yml node scripts/product-map/realmachine-unverified-ratchet.mjs)
AFTER_COUNT=$(echo "$AFTER_JSON" | jq -r '.realmachine_unverified_count')
rm -rf "$TMPSMOKE"

[ "$AFTER_COUNT" -gt "$BASELINE_COUNT" ] || { echo "❌ FAIL: 新增未覆盖步骤后计数应上升，baseline=$BASELINE_COUNT after=$AFTER_COUNT"; FAIL=1; }
echo "✅ 棘轮计数正确上升 baseline=$BASELINE_COUNT → after=$AFTER_COUNT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "④ nightly-real-machine-staging.yml 可见新刀D job"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
grep -q "account-scan-realmachine-smoke.sh" .github/workflows/nightly-real-machine-staging.yml \
  || { echo "❌ FAIL: nightly-real-machine-staging.yml 未引用 account-scan-realmachine-smoke.sh"; FAIL=1; }
grep -qE "needs:\s*\[.*account.scan.*\]|needs:\s*\[wechat-bubble,\s*douyin-read,\s*account-scan\]" .github/workflows/nightly-real-machine-staging.yml \
  || echo "⚠️  提示：nightly-report needs 列表未见含 account-scan 的宽松匹配，人工确认实际 job 名"
echo "✅ 新刀D job 已接入 nightly workflow"

[ "$FAIL" -eq 0 ] && echo "✅✅✅ 真机验证车道三层防假绿守卫 — 全部验收通过" || { echo "❌❌❌ 存在未通过项，见上"; exit 1; }
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| account-scan-realmachine-smoke.sh 无设备环境降级 | `tests/account-scan-realmachine-smoke.envfail.test.sh` | 无设备环境应 exit 3(环境未就绪) | 脚本不存在 → bash 报 No such file，exit 127（非 3）→ N failures |
| account-scan-realmachine-smoke.sh 两段式终态联合断言（round 2 新增，回归覆盖 status≠done 但 account_ids 恰好非空的原始 bug 反例） | `tests/account-scan-realmachine-smoke.terminal-assert.test.sh` | status=failed 但 account_ids 非空 → 正确判红 / status=done 且 account_ids 非空 → 正确判绿 / status=done 但 account_ids 为空 → 正确判红 | 脚本不存在或 `assert_task_terminal_success` 未定义 → RED 分支 exit 1 → N failures |
| lint-smoke-mock-honesty.sh 检测规则 | `tests/lint-smoke-mock-honesty.test.sh` | 漏标记的假payload步骤未被抓 / 补标记后期望通过 / 真实仓库现状应通过 | 脚本不存在 → exit 127 → N failures |
| realmachine-unverified-ratchet 纯函数 | `tests/realmachine-unverified-ratchet.test.js`（Generator 落地时复制到 `scripts/product-map/__tests__/realmachine-unverified-ratchet.test.js`，同 `gp-smoke-ratchet.test.js` 先例） | 新增未覆盖步骤后计数应上升 / 全部标记均有效覆盖时计数为0 / 缺nightly_ref的标记同样计入未覆盖 | `computeRealmachineUnverifiedRatchet` 未导出 → import 报错 → N failures |
