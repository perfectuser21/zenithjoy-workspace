# call_state 真实检测能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `device_info` 指令返回的 `call_state` 从写死的占位值 `unknown` 换成 TelephonyManager 实测的真实值，让 `douyin-phone-runtime` skill 的安全停止判断不再被"检测能力缺失"永久拦停。

**Architecture:** 不新增指令类型，复用现有 `device_info` 透传架构；Android 端加权限声明 + 探测函数 + 授权 UI；bash 端把硬编码值改成读取透传字段。

**Tech Stack:** Kotlin（TelephonyManager + ContextCompat 权限检查），bash（jq 取值），JUnit（透传回归测试），Node test runner（脚本层 TDD）。

---

## Task 1: AndroidManifest.xml 加通话状态权限声明

**Files:**
- Modify: `services/agent-android/app/src/main/AndroidManifest.xml:10`（紧跟 `RECORD_AUDIO` 那一行之后）

- [ ] **Step 1: 加权限声明**

在第10行 `<uses-permission android:name="android.permission.RECORD_AUDIO" />` 之后新增一行：

```xml
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
```

- [ ] **Step 2: 确认文件语法正确**

Run: `grep -A1 "RECORD_AUDIO" services/agent-android/app/src/main/AndroidManifest.xml`
Expected: 看到新增的 `READ_PHONE_STATE` 行紧跟在 `RECORD_AUDIO` 之后，缩进/格式与相邻行一致

- [ ] **Step 3: Commit**

```bash
git add services/agent-android/app/src/main/AndroidManifest.xml
git commit -m "feat(agent-android): 声明 READ_PHONE_STATE 权限，为通话状态检测铺垫"
```

---

## Task 2: AgentService.kt 实现 callStateProbe() 并接入 device_info

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`（`deviceInfo` lambda 在约第602-612行）
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt`

> 说明：`CommandExecutor` 对 `deviceInfo()` 的返回值是原样透传（`CommandExecutor.kt:68` `CmdAction.DEVICE_INFO -> CmdOutcome(true, data = deviceInfo())`），这条透传逻辑对任意 map 都成立，不需要为了加 `callState` 字段去改 `CommandExecutor.kt` 本身。因此 Step 1 的测试是一条"确认现有透传架构能扛住新字段"的回归锁定测试，写完直接就是绿的（不是 TDD 红灯），这是设计文档里说明过的架构事实，不是漏做 TDD。真正需要新写、且没有自动化测试覆盖的是 Step 3 的 `callStateProbe()` 函数本身（直接调用 Android 框架 API，只能真机验证，已在设计文档"测试策略"一节写明）。

- [ ] **Step 1: 在 CommandExecutorTest.kt 里加一条 callState 透传回归测试**

在 `CommandExecutorTest.kt` 现有 `` `回执总带 inReplyTo 与前台包名` `` 测试之后加一条新测试：

```kotlin
    @Test fun `deviceInfo 返回的 callState 字段原样透传`() = runTest {
        val e = executor()
        // executor() 默认 deviceInfo = { mapOf("model" to "TEST") }，这里单独覆盖验证透传架构
        val custom = CommandExecutor(
            remoteControlEnabled = { true },
            nativeBusy = { false },
            foregroundPkg = { "com.ss.android.ugc.aweme" },
            gesture = GestureRunner(dispatch = { _, _, onResult -> onResult(true); true }),
            screenshot = ScreenshotRunner({ true }, { true }, { "b64" }, { 1080 to 2400 }, sleep = {}),
            type = TypeRunner({ "com.ss.android.ugc.aweme" }, setOf("com.ss.android.ugc.aweme"), { true }),
            launch = LaunchRunner(setOf("com.ss.android.ugc.aweme"), { true }, { true }, { "com.ss.android.ugc.aweme" }, sleep = {}),
            globalAction = { true },
            deviceInfo = { mapOf("model" to "MAA-AN00", "callState" to "idle") },
            treeDump = { mapOf("tree" to "d0 root", "truncated" to false) },
        )
        val m = custom.execute(req(CmdAction.DEVICE_INFO))
        val data = m["data"] as Map<*, *>
        assertEquals("idle", data["callState"])
    }
```

- [ ] **Step 2: 跑测试确认它已经是绿的（架构确认，不是 TDD 红灯）**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.command.CommandExecutorTest"`
Expected: PASS（这条测试验证的是既有透传架构，此刻还没改 `AgentService.kt`，理应直接通过）

- [ ] **Step 3: 在 AgentService.kt 实现 callStateProbe() 并接入 deviceInfo lambda**

在 `AgentService.kt` 顶部 import 区加：

```kotlin
import android.Manifest
import android.content.pm.PackageManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
```

（若这些 import 已存在于文件中则跳过重复添加）

在 `deviceInfo` lambda 所在的类作用域内（`AgentService` 类体内，与其它私有函数同级）新增：

```kotlin
    /**
     * 通话状态探测：`douyin-phone-runtime` skill 的安全停止判断依赖 call_state!=idle
     * 这个信号，未授权 READ_PHONE_STATE 时必须显式返回 "permission_denied"，
     * 绝不能静默当 "idle" ——那会让上游误判为"可以继续操作"，
     * 万一手机正在通话中会被自动化操作打断（决策 74f71907）。
     */
    private fun callStateProbe(): String {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.READ_PHONE_STATE,
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

把 `deviceInfo` lambda（原第602-612行附近）改成：

```kotlin
            deviceInfo = {
                val (sw, sh) = realScreenSize()
                mapOf(
                    "model" to android.os.Build.MODEL,
                    "manufacturer" to android.os.Build.MANUFACTURER,
                    "androidVersion" to android.os.Build.VERSION.RELEASE,
                    "agentVersion" to BuildConfig.VERSION_NAME,
                    "screenWidth" to sw,
                    "screenHeight" to sh,
                    "callState" to callStateProbe(),
                )
            },
```

- [ ] **Step 4: 编译确认无语法错误**

Run: `cd services/agent-android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: 跑完整单元测试确认没有破坏其它用例**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest`
Expected: 全部 PASS（`callStateProbe()` 本身因为直接调用 Android 框架 API，在纯 JVM unit test 环境跑不到——这是已知的、设计文档里写明的限制，不需要为此引入 Robolectric）

- [ ] **Step 6: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt \
        services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/command/CommandExecutorTest.kt
git commit -m "feat(agent-android): device_info 新增 callState 真实探测，替代占位 unknown"
```

---

## Task 3: MainActivity.kt 加通话状态权限申请 UI

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt`

> 说明：这一步是纯 UI 交互代码，无自动化测试覆盖（跟现有 `recordAudioBanner()` 一致的模式），靠 Task 4 之后的真机人工验证确认。

- [ ] **Step 1: 加权限申请 launcher**

在 `MainActivity.kt` 里 `recordAudioPermissionLauncher`（第53-61行）定义之后，新增：

```kotlin
    private val callStatePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            android.util.Log.i(TAG, "READ_PHONE_STATE authorized")
        } else {
            android.util.Log.w(TAG, "READ_PHONE_STATE denied — call_state stays permission_denied")
            Toast.makeText(this, "通话状态授权被拒绝，安全预检将持续拦停", Toast.LENGTH_LONG).show()
        }
        showStatus()
    }
```

- [ ] **Step 2: 加状态自检 banner 函数**

在 `recordAudioBanner()` 函数（第155-169行）之后新增：

```kotlin
    /** 状态自检：READ_PHONE_STATE 权限是否就绪，未授权时 call_state 恒为 permission_denied，
     * douyin-phone-runtime skill 会因此永久安全停止，方便真机巡检定位。 */
    private fun callStateBanner(): android.view.View {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.READ_PHONE_STATE,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) {
            TextView(this).apply { text = "通话状态授权 ✅ 已授权（call_state 可用）" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ 通话状态未授权，call_state 恒为 permission_denied，获客流程将持续安全停止" })
            box.addView(Button(this).apply {
                text = "授权通话状态"
                setOnClickListener { callStatePermissionLauncher.launch(Manifest.permission.READ_PHONE_STATE) }
            })
            box
        }
    }
```

- [ ] **Step 3: 接入 showStatus()**

在 `showStatus()` 函数里找到 `layout.addView(recordAudioBanner())`（第298行），紧跟其后新增一行：

```kotlin
        layout.addView(callStateBanner())
```

- [ ] **Step 4: 编译确认**

Run: `cd services/agent-android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt
git commit -m "feat(agent-android): 状态页加通话状态授权入口"
```

---

## Task 4: adb-controller-bridge.sh 读取真实 callState（TDD）

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh:73-134`（`cmd_preflight` 函数）
- Test: `scripts/openclaw/__tests__/adb-controller-bridge.test.js:88-138`（原有 `call_state=unknown` 断言）

- [ ] **Step 1: 改现有测试，让它对着真实 callState 断言（先改测试，此时脚本还没改，测试应该失败）**

把 `adb-controller-bridge.test.js` 里这条测试（第88行 `test('preflight：device_info 成功 + 有 active burner session → account_verified=true，call_state=unknown', ...)`）的 mock 返回体和断言改成：

```javascript
test('preflight：device_info 成功且带 callState 字段 → 原样透传，不再是硬编码 unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res, body) => {
      if (req.url === `/api/devices/${AGENT_ID}/actions`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', data: { model: 'MAA-AN00', manufacturer: 'HONOR', androidVersion: '15', agentVersion: '2.1.48', callState: 'idle' }, outcome: 'completed' } }));
        return;
      }
      if (req.url === '/api/agent/burner/sessions') {
        assert.equal(req.headers['x-tenant-id'], TENANT_ID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { sessions: [
          {
            account_label: 'test-burner', role: 'burner', status: 'active',
            bound_at: '2026-09-01T00:00:00.000Z', device_type: 'android',
            created_at: '2026-09-01T00:00:00.000Z', agent_id: AGENT_ID,
            uia_online: true, uia_checked_at: '2026-09-04T00:00:00.000Z', uia_error: null,
            agent_hostname: 'rog-01', agent_nickname: 'rog', agent_status: 'online',
            last_heartbeat_at: '2026-09-04T00:00:00.000Z', heartbeat_online: true,
            account_nickname: 'test-nickname', computed_online_status: 'online',
          },
        ] } }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
      PROFILES_FILE: profilesFile,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
      ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.account_verified, true);
    assert.equal(out.sessions_check_ok, true);
    assert.equal(out.call_state, 'idle');
    assert.equal(out.model, 'MAA-AN00');
    assert.ok(!out.warnings.some((w) => w.includes('call_state 检测能力缺失')));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preflight：device_info 返回体缺失 callState 字段 → 降级为 unknown 并保留 warning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  let server;
  try {
    const profilesFile = makeProfilesFile(dir);
    server = await startMockServer((req, res, body) => {
      if (req.url === `/api/devices/${AGENT_ID}/actions`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 模拟老版本 APK（还没升级、没有 callState 字段）
        res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', data: { model: 'MAA-AN00', manufacturer: 'HONOR', androidVersion: '15', agentVersion: '2.1.47' }, outcome: 'completed' } }));
        return;
      }
      if (req.url === '/api/agent/burner/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { sessions: [] } }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    const { port } = server.address();
    const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
      PROFILES_FILE: profilesFile,
      ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
      ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.call_state, 'unknown');
    assert.ok(out.warnings.some((w) => w.includes('call_state')));
  } finally {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认它现在失败（脚本还没改，call_state 仍固定输出 unknown）**

Run: `cd scripts/openclaw && node --test __tests__/adb-controller-bridge.test.js`
Expected: FAIL — 第一条新测试断言 `out.call_state === 'idle'` 失败，因为脚本仍硬编码输出 `unknown`

- [ ] **Step 3: Commit failing test**

```bash
git add scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "test(openclaw): call_state 应透传真实值而非硬编码 unknown（红灯）"
```

- [ ] **Step 4: 修改 cmd_preflight() 读取真实 callState**

在 `adb-controller-bridge.sh` 里，把第82-84行：

```bash
  local model foreground
  model=$(echo "$dinfo" | jq -r '.data.model // "unknown"')
  foreground=$(echo "$dinfo" | jq -r '.foregroundPkg // "unknown"')
```

改成：

```bash
  local model foreground call_state
  model=$(echo "$dinfo" | jq -r '.data.model // "unknown"')
  foreground=$(echo "$dinfo" | jq -r '.foregroundPkg // "unknown"')
  call_state=$(echo "$dinfo" | jq -r '.data.callState // "unknown"')
```

然后找到 `emit_ok` 那段 jq 构造（原先硬编码 `call_state:"unknown"` 的位置，在函数末尾 `emit_ok "$(jq -n ...)"` 调用里），把：

```bash
  emit_ok "$(jq -n \
    --arg profile "$PROFILE" --arg serial "$AGENT_ID" --arg model "$model" \
    --arg fg "$foreground" --argjson verified "$account_verified" \
    --argjson sessions_check_ok "$sessions_check_ok" --arg sessions_warning "$sessions_warning" \
    '{ok:true, profile:$profile, serial:$serial, model:$model, adb_state:"device",
       call_state:"unknown", foreground_pkg:$fg, account_verified:$verified,
       sessions_check_ok:$sessions_check_ok,
       warnings: (["call_state 检测能力缺失，douyin-phone-runtime skill 要求 call_state!=idle 时安全停止，这里无法提供该判据，调用方需自行决定是否继续"]
         + (if $sessions_warning != "" then [$sessions_warning] else [] end))}')"
```

改成：

```bash
  local call_state_warnings="[]"
  if [ "$call_state" = "unknown" ]; then
    call_state_warnings='["call_state 无法确认（设备端 callState 字段缺失或读取失败），douyin-phone-runtime skill 要求 call_state!=idle 时安全停止，这里无法提供该判据，调用方需自行决定是否继续"]'
  fi
  emit_ok "$(jq -n \
    --arg profile "$PROFILE" --arg serial "$AGENT_ID" --arg model "$model" \
    --arg fg "$foreground" --arg cs "$call_state" --argjson verified "$account_verified" \
    --argjson sessions_check_ok "$sessions_check_ok" --arg sessions_warning "$sessions_warning" \
    --argjson call_state_warnings "$call_state_warnings" \
    '{ok:true, profile:$profile, serial:$serial, model:$model, adb_state:"device",
       call_state:$cs, foreground_pkg:$fg, account_verified:$verified,
       sessions_check_ok:$sessions_check_ok,
       warnings: ($call_state_warnings
         + (if $sessions_warning != "" then [$sessions_warning] else [] end))}')"
```

- [ ] **Step 5: 语法检查**

Run: `bash -n scripts/openclaw/adb-controller-bridge.sh`
Expected: 无输出（语法通过）

- [ ] **Step 6: 跑测试确认变绿**

Run: `cd scripts/openclaw && node --test __tests__/adb-controller-bridge.test.js`
Expected: PASS — 两条新测试都通过，且其它既有测试（如 `account_verified` 相关的两条）不受影响

- [ ] **Step 7: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh
git commit -m "fix(openclaw): cmd_preflight 读取真实 callState，不再硬编码 unknown"
```

---

## Task 5: 全量测试 + 真机验证

**Files:** 无新文件改动，本 task 是验收步骤。

- [ ] **Step 1: 跑全量 Android 单元测试**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest`
Expected: 全部 PASS

- [ ] **Step 2: 跑全量 openclaw 脚本测试**

Run: `cd scripts/openclaw && node --test __tests__/*.test.js`
Expected: 全部 PASS

- [ ] **Step 3: 构建新 APK 并部署到测试机（HONOR MAA-AN00，`zenithjoy-bridge-smoke` profile）**

这一步需要仓库现有的 Android 构建/部署流程（沿用之前 PR#1762/#1765/#1771/#1777 系列的部署方式），构建产物安装到 ROG 连接的测试机上。

- [ ] **Step 4: 真机验证——未授权场景**

保持 `READ_PHONE_STATE` 未授权，调用：

```bash
/opt/openclaw/zenithjoy-bridge/scripts/douyin-phone-adb-bridge --profile zenithjoy-bridge-smoke preflight
```

Expected: 返回体里 `call_state` 为 `"permission_denied"`，`warnings` 数组含 call_state 相关提示

- [ ] **Step 5: 真机验证——已授权场景**

在测试机状态页点击"授权通话状态"按钮，系统弹窗同意后，重新调用同一条命令。

Expected: 非通话状态下，`call_state` 为 `"idle"`，且 `warnings` 数组里不再包含 call_state 相关提示

- [ ] **Step 6: 端到端确认——之前被拦停的独立测试 workflow 能否推进到 discovery 阶段**

重新触发这次会话里用的独立验证副本 webhook（`AwrSocialLeadgenV4BridgeTest`），观察 preflight 阶段裁决通过后是否不再走"中止归档"分支，而是真正推进到"阶段 视频发现"。

Expected: n8n execution 的已执行节点列表里出现 discovery 相关节点（而非停在"裁决 手机预检 → 准备中止归档"）

- [ ] **Step 7: Commit（如验证脚本/记录有变动）**

若真机验证发现需要微调（如 warning 文案），补一条 commit；若全部符合预期，无需额外 commit，直接进入 finishing 流程。
