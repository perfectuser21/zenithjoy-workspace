# 信号桥"打开搜索并输入关键词"命令 设计文档

## 背景

真机验证（run_id `social-keyword-leadgen-20260906043102-lu3rus`）显示：`douyin-phone-runtime` skill 的 discovery 阶段两次 retry 后失败退出，唯一原因是"controller lacks the required open-search entrypoint"——信号桥（`adb-controller-bridge.sh` → `phonectl.sh` → 中台 API → `agent-android`）目前完全没有"打开搜索框、输入关键词"这个能力。

这是继 call_state（PR#1784/#1786）之后信号桥命令集的下一个真实缺口，走 `/dev` 路径 B（小改动）。

## 现场验证（本次真机 adb 探索已确认）

- ✅ 搜索图标（真机截图目视定位）点击后进入搜索页，输入框自动聚焦、键盘弹出
- ✅ `adb shell input text 装修` 直接抛 `NullPointerException`（`InputShellCommand.sendText` 无法编码中文按键）——adb 原生输入完全不可行，证实必须走无障碍服务 `ACTION_SET_TEXT`
- ⚠️ `uiautomator dump` 在首页（动态视频流）无法达到 idle state——语义定位必须走无障碍服务自身查询树，不能依赖系统 uiautomator 命令

## 现有代码基础（调研结论）

`DouyinCollectService.kt:489-675`（`openSearchBar`/`typeKeyword`/`triggerSearch`）已经是一套经过大量真机踩坑加固的"点搜索入口→输入关键词→提交搜索"实现，但它是**私有方法**，服务于设备端自身的两阶段采集状态机（`Stage1_SEARCH`），跟 `AgentService` 的 `CommandExecutor`/Runner 体系是两条独立代码路径。本次新增复用其**定位策略与容错节奏**（不直接调用），实现为独立的 `OpenSearchRunner`。

## 架构决策

### 决策 1：新增指令走三处硬编码字符串对齐（沿用现有模式，不引入共享 schema）

现有 8 个指令（`SCREENSHOT`/`TAP`/`SWIPE`/`TYPE`/`KEY`/`LAUNCH`/`DEVICE_INFO`/`TREE_DUMP`）在三处独立硬编码对齐：设备端 `CommandProtocol.CmdAction` 枚举、中台 `ACTION_WHITELIST`、`phonectl.sh` 的 `case`。新增 `open_search` 沿用同一模式（不在本次引入共享常量重构，范围超出本次 PrepPRD）。三处新增：

1. `CommandProtocol.kt`：`CmdAction` 枚举加 `OPEN_SEARCH`；`parse()` 的 `when` 加 `"open_search" -> CmdAction.OPEN_SEARCH`，校验 `keyword` 参数非空字符串
2. `apps/api/src/routes/devices.ts`：`ACTION_WHITELIST` 加 `'open_search'`
3. `scripts/openclaw/phonectl.sh`：`case "$ACTION" in` 加 `open_search)` 分支，拼 `{keyword:$kw}` 到 `ARGS_JSON`

`TAP_ACTIONS`（`devices.ts:35`，双闸频控）本次**不加入** `open_search`——它已经在 `sensitive`/`mutating` 门禁下受 `actions_per_minute` 总闸约束，是否需要更细粒度频控留给生产观察后再决定，不在本次预先加码。

`agentSupportsCmd()` 版本门槛（`devices.ts:59-69`）本次**不改**——沿用现有"整个 cmd 能力一刀切"判据（含 `open_search` 在内的整套指令随下次 agent OTA 一起生效），不引入单指令粒度的能力协商机制（超出本次范围）。

### 决策 2：`OpenSearchRunner` 独立实现，不复用 `DouyinCollectService` 私有方法

新建 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/command/OpenSearchRunner.kt`，构造函数注入风格参照 `TypeRunner`/`LaunchRunner`。核心逻辑三步（参照 `DouyinCollectService.kt:489-675` 的定位策略与容错节奏重新实现，不引入跨服务调用）：

1. **定位搜索入口并点击**：`rootInActiveWindow` 查找 content-desc/text 含"搜索"的节点（`findNodeByContentDescCheap` 风格：先系统索引 `findAccessibilityNodeInfosByText` 缩小候选，未命中退回带节点数上限的 BFS）；找不到返回新错误码 `ERR_SEARCH_ENTRY_NOT_FOUND`。点击用 `clickNodeRobustly` 风格（自身可点击走 `ACTION_CLICK`，否则退回坐标手势）。
2. **写入关键词**：点击后重新抓 root，定位新出现的可编辑输入框（`findFirstEditText` 风格 BFS，不假设"已聚焦"，因为搜索框是点击后才出现的）→ `ACTION_CLICK` 聚焦 → `Bundle` + `ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE` 走 `ACTION_SET_TEXT` 写入关键词（与 `AgentService.kt:560-571` 现有 `setTextOnFocusedEditable` 逻辑一致的 API 调用方式，本次单独实现一份因为前置定位逻辑不同）。找不到输入框返回 `ERR_NO_FOCUSED_EDITABLE`（复用现有错误码）；`ACTION_SET_TEXT` 失败返回 `ERR_SET_TEXT_FAILED`（复用现有错误码）。
3. **提交搜索**：三态尝试（参照 `triggerSearch` 风格）——找确认按钮 `ACTION_CLICK`，其次找"搜索"文本节点手势点击，最后 `ACTION_IME_ENTER` 兜底提交。全部失败返回新错误码 `ERR_SEARCH_SUBMIT_FAILED`。

三步全部成功后返回 `{ok: true}`；`CommandExecutor` 统一拼回执 map（复用现有 `buildResult`）。

### 决策 3：白名单与门禁

- 白名单包名沿用 `AgentService.kt:522-525` 现有 `cmdWhitelist`（抖音正式/极速版两个包），本次不扩大范围（PrepPRD 明确只服务抖音搜索场景）。
- `OPEN_SEARCH` 同时加入 `sensitive` 集合（含打字，属敏感操作，需 `remoteControlEnabled()`）和 `mutating` 集合（会点击/改变前台状态，需抢 `AutomationLease`）——与 `TYPE`/`LAUNCH` 同等级别门禁。

### 决策 4：`adb-controller-bridge.sh` 新命令

新增 `cmd_open_search_evidence()`，直接沿用 `cmd_tap_evidence` + `finish_action_evidence` 结构（`adb-controller-bridge.sh:334-373`）：

```
open-search-evidence <keyword> <evidence_id> [wait_ms]
```

- 参数校验：`keyword`/`evidence_id` 非空，`evidence_id` 过 `validate_evidence_id()`（防路径穿越）
- `call_phonectl open_search --arg keyword "$keyword"` → 失败走 `extract_phonectl_error "OPEN_SEARCH_FAILED" "打开搜索失败"`
- 成功走 `finish_action_evidence "$evidence_id" "$wait_ms"`（复用现有截图落盘证据链路）
- 末尾 `case "$COMMAND" in` 新增一行分发

### 决策 5：命令留痕（command-trace，横切需求）

在 `adb-controller-bridge.sh` 最外层 `case "$COMMAND" in ... esac` 分发**之前**统一打点（不逐个 `cmd_*` 函数内加），避免遗漏新命令、也不用逐个函数改。

**分桶键改用 `$PROFILE`，不用 evidence_id**：`validate_evidence_id()`（`adb-controller-bridge.sh:258`）校验正则是 `^[A-Za-z0-9._-]+$`，**不允许冒号**，所以 evidence_id 不可能是 `search:s1:screen1` 这种带冒号的格式；另外 evidence_id 在不同命令里的参数位置并不固定（`tap-evidence x y evidence_id` 是第 3 位，`back-evidence evidence_id` 是第 1 位，新增的 `open-search-evidence keyword evidence_id` 会是第 2 位），硬编码固定位置提取必然经常提错。`$PROFILE` 是脚本入口 `--profile` 参数、已经过 `^[A-Za-z0-9_-]+$` 校验、且**每次调用都必然存在**（不像 evidence_id 只有部分命令才有），用它做分桶键更稳妥也更完整（连 `preflight`/`lock-*` 这些没有 evidence_id 的命令也能留痕）：

```bash
# 在分发 case 之前
jq -nc --arg cmd "$COMMAND" --arg args "$*" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{command:$cmd, args:$args, ts:$ts}' >> "${COMMAND_TRACE_DIR:-/tmp}/${PROFILE}.command-trace.jsonl" 2>/dev/null || true
```

**范围声明（YAGNI）**：只记录"调用了什么命令、什么参数、什么时候"，不记录成功/失败结果（结果已经完整存在于 Work Commander 的 `workflow-runs/*.json` evidence 里，不重复记录）。`COMMAND_TRACE_DIR` 环境变量可配置落盘目录（默认 `/tmp`，HK-VPS 部署时配置为持久化目录）；追加失败（如目录不可写）静默降级不阻断主流程（`|| true`）。

**跨多次运行的切分**：同一 profile 的 trace 文件会持续追加，蒸馏时靠每行的 `ts` 时间戳按时间邻近性分组即可区分不同的 workflow run，不需要额外的 run_id 字段（YAGNI，够用为止）。

## 不包含（本次范围外）

- 不重构 `DouyinCollectService`/`DouyinDmOutreachService`/`DeviceAccountScanService` 三份重复的节点查找工具函数为共享 util（调研发现的既有技术债，超出本次 PrepPRD 范围）
- 不引入单指令粒度的 agent 能力协商机制（`agentSupportsCmd` 沿用现有"整套 cmd 能力一刀切"判据）
- 不改 `TAP_ACTIONS` 频控集合
- command-trace 不记录执行结果，只记录调用（YAGNI，结果已在 workflow-runs JSON 里）

## 测试策略

- **Unit（Kotlin）**：`OpenSearchRunnerTest.kt`（参照 `TypeRunnerTest.kt`/`LaunchRunnerTest.kt` 风格）——覆盖搜索入口找到/找不到、输入框找到/找不到、`ACTION_SET_TEXT` 成功/失败、三态提交每一态成功、全部提交方式失败。`CommandExecutorTest.kt` 补充门禁测试（远程协助关闭时拒绝、原生忙时拒绝、正常路径 `ok:true`）。
- **Unit（Bash/Node）**：`adb-controller-bridge.test.js` 新增 `open-search-evidence` 测试组，参照 `open-app` 测试片段风格（起真实 mock HTTP server，校验 `capturedBody.action === 'open_search'` 且 `keyword` 字段正确传递、成功/失败/参数校验边界）；新增 command-trace 追加写入格式测试。
- **Integration（TypeScript）**：`apps/api/src/routes/__tests__/devices.test.ts` 补充 `open_search` 走通的正向用例（原有"未知 action 400"反向用例保持不变，验证未在白名单时依然 400）。
- **真机 E2E**：秦军餐饮测试号上实际调用 `open-search-evidence 装修 <evidence_id>`，验证真实进入搜索结果页（截图证据），且中文关键词正确写入（视觉核对搜索框内容）。

## 验收标准

- [ ] 三处 action 白名单/枚举同步新增且拼写一致（`CommandProtocol.kt`/`devices.ts`/`phonectl.sh`）
- [ ] `OpenSearchRunner` 单测覆盖上述边界，`CommandExecutor` 门禁测试通过
- [ ] `adb-controller-bridge.sh` 新命令 + command-trace 留痕单测通过
- [ ] `devices.test.ts` 正向用例通过
- [ ] 真机验证：搜索"装修"成功进入结果页，中文关键词写入正确
- [ ] HK-VPS 部署同步（避免 call_state 那次"脚本与仓库脱节"重演）
- [ ] CI 全绿
