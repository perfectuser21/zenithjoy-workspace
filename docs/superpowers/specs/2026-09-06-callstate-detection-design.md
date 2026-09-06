# 给 douyin-phone-runtime 信号桥补真实通话状态检测 — 设计

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 执行本设计对应的实现计划。

**Goal**：把 `device_info` 指令返回的 `call_state` 从写死的占位值 `unknown`，换成 TelephonyManager 实测的真实值（`idle`/`ringing`/`offhook`/`permission_denied`），让 `adb-controller-bridge.sh` 的 `cmd_preflight` 能把真值透传给 `douyin-phone-runtime` skill 的安全停止判断。

**归位**：`customer_app/line02/keyword_acquisition` · keep-green（不新增格子坐标，补齐既有信号桥的已知缺口）。

**架构**：不新增指令类型，复用现有 `device_info` 指令的返回值结构。整条链路（`CommandExecutor` → 中台 `POST /:agentId/actions` → `phonectl.sh` → `adb-controller-bridge.sh`）对 `data` 字段是纯透传架构，唯一要写的实质代码是 Android 端 `AgentService.kt` 里的 `callStateProbe()` 探测函数 + 权限声明/申请。

**Tech Stack**：Kotlin（`TelephonyManager`/`SubscriptionManager`，minSdk 26 / targetSdk 34，用 `ContextCompat.checkSelfPermission` + `ActivityResultContracts.RequestPermission()`，跟现有 `RECORD_AUDIO` 权限模式一致）；bash（`adb-controller-bridge.sh` 一行取值逻辑改动）。

---

## 组件与文件

### 修改（不新增文件）

| 文件 | 改动 |
|---|---|
| `services/agent-android/app/src/main/AndroidManifest.xml` | 加 `<uses-permission android:name="android.permission.READ_PHONE_STATE" />` |
| `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt` | 新增 `callStateProbe()` 私有函数；`deviceInfo` lambda（约行602-612）加一行 `"callState" to callStateProbe()` |
| `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt` | 仿照 `recordAudioPermissionLauncher`（行53-61）/`recordAudioBanner()`（行155-169）模式，加 `callStatePermissionLauncher` + `callStateBanner()`，在 `showStatus()`（行298 `recordAudioBanner()` 调用处）追加一行 `layout.addView(callStateBanner())` |
| `scripts/openclaw/adb-controller-bridge.sh` | `cmd_preflight()` 里把硬编码 `call_state:"unknown"` 改成从 `dinfo` 取 `.callState`（取不到时降级为 `unknown` 并保留原 warning） |
| `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt` | 新增用例：`deviceInfo` mock 返回含 `callState` 字段时，`CmdOutcome.data` 原样透传 |
| `scripts/openclaw/__tests__/adb-controller-bridge.test.js` | 更新第135/137行断言（原先断言 `call_state === 'unknown'` 及固定 warning 文案），改为按 mock 的 `device_info.data.callState` 值断言透传，并新增"取不到 callState 字段时降级为 unknown"的用例 |

---

## 核心逻辑：callStateProbe()

```kotlin
private fun callStateProbe(): String {
    val granted = ContextCompat.checkSelfPermission(
        this@AgentService, Manifest.permission.READ_PHONE_STATE,
    ) == PackageManager.PERMISSION_GRANTED
    if (!granted) return "permission_denied"
    return try {
        val tm = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        when (tm.callState) {
            TelephonyManager.CALL_STATE_IDLE -> "idle"
            TelephonyManager.CALL_STATE_RINGING -> "ringing"
            TelephonyManager.CALL_STATE_OFFHOOK -> "offhook"
            else -> "unknown"
        }
    } catch (e: SecurityException) {
        "permission_denied"
    } catch (e: Exception) {
        "unknown"
    }
}
```

**判定点（已拍板）**：`granted=false` 时明确返回 `"permission_denied"`，绝不静默返回 `"idle"`——`douyin-phone-runtime` skill 只对 `call_state=idle` 放行，其余任何值（含 `unknown`/`permission_denied`）都触发安全停止，跟现状行为一致，不会因为这次改动意外放宽安全边界。

**API 选型**：用已弃用但仍可用的 `TelephonyManager.getCallState()`（无 subId 参数版本，minSdk 26 起可用，无需处理多 SIM 卡 subId 选择的复杂度）。`getCallStateForSubscription()`（API31+）精度更高但要多处理"如何选 subId"这个新判定点，而现有真机（HONOR MAA-AN00 单卡）用不上这个精细度，YAGNI——不引入未验证过的复杂度。

**SecurityException 兜底**：即使 manifest 已声明权限，`checkSelfPermission` 校验通过后再调用 `getCallState()` 理论上不应抛异常，但保留 catch 兜底（防御性编程，跟仓库里其它涉及系统 API 调用的地方一致风格），异常时返回 `unknown`（不是 `permission_denied`，因为权限检查已经通过，这属于未知异常而非权限问题）。

---

## 测试策略

- **Unit（JUnit，不需要真机）**：
  - `CommandExecutorTest.kt`：验证 `deviceInfo` lambda 返回值里的任意字段（含新增 `callState`）都被 `CmdOutcome.data` 原样透传——这条测试不需要真的调用 `callStateProbe()` 本身（继续走现有 lambda mock 注入模式），只验证"分发层不篡改/不丢字段"。
  - `adb-controller-bridge.test.js`：mock 中台返回 `device_info.data.callState` 为 `idle`/`ringing`/`permission_denied`/字段缺失四种情况，断言 `cmd_preflight` 输出的 `call_state` 分别透传正确值 / 缺失时降级为 `unknown`。
- **真机人工验证（CI 覆盖不到，`callStateProbe()` 本身直接调用 `android.telephony`/`ContextCompat` 框架 API，仓库未引入 Robolectric）**：
  1. 测试机（HONOR MAA-AN00，`zenithjoy-bridge-smoke` profile）安装新版本 APK 后，`MainActivity` 状态页应出现"通话状态未授权"提示 + 授权按钮（复用 `recordAudioBanner` 模式）
  2. 点击授权、系统弹窗同意后，调用 `preflight` 应返回 `call_state: "idle"`（非通话状态下）
  3. 保持未授权，调用 `preflight` 应返回 `call_state: "permission_denied"`（不是 `unknown`，用于跟"检测能力缺失"区分开）
  4. （可选，不阻塞验收）真实来电时观察 `ringing`/`offhook` 是否正确反映
- **trivial**：`AndroidManifest.xml` 权限声明本身无需测试，靠上面第1步真机验证间接确认声明生效（否则 `checkSelfPermission` 永远返回 denied，第2步测不出 `idle`）。

---

## 已知缺口（本次范围内明确不做）

1. 不处理多 SIM 卡分别取状态（YAGNI，见上方 API 选型说明）
2. 不新增"通话状态"的独立轮询指令（复用 `device_info` 足够满足 `douyin-phone-runtime` skill 当前的 preflight 一次性判定需求）
3. 真实来电 ringing/offhook 场景的真机验证是"可选、不阻塞验收"——用户很难配合"专门打个电话去测"，`idle` 和 `permission_denied` 两态验证到位即可交付；后续真机自然遇到来电时若有异常再回来修
