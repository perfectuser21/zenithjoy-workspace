# Sprint Contract Draft (Round 1)

Sprint: **Agent 客户端封装（去黑窗 + 托盘静默通知）**
journey_type: `agent_remote`
target_environment: `windows_cloud`（GHA windows-latest 干净 VM；执行 `${SPRINT_DIR}/e2e-verify.ps1`）

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应**。本 sprint 改造客户机 Agent 启动入口（start.vbs）+ 托盘通知逻辑（tray.ts）+ 打包/自启脚本，不新增任何 Brain/HTTP 端点（PRD「预期受影响文件」「不在范围内：诊断报告页/权限后台/API」已明确）。Reviewer 第 6 维 verification_oracle_completeness 中"response 字段 codify"项对本 sprint 自动满分；oracle 完整性按"源码行为断言 + 启动机制行为"审。

## 已知约束（来自回归测试）

- [src/__tests__/start-bat-single-instance.test.ts] start.bat 必须先 `Get-Process -Name zenithjoy-agent | Stop-Process -Force`（kill 旧实例）再启动；kill 须在启动命令之前；用 `-ErrorAction SilentlyContinue` 防首启无旧进程报错。
  → **本 sprint 不得破坏此回归**：start.bat 既有 Step 6.95 单实例 kill 逻辑保留不动。本 sprint 的"单实例不重复拉起"加在 **start.vbs 层**（已运行则 vbs 直接跳过、不再拉 start.bat），与 start.bat 的 kill+restart 并存不冲突。
- [src/__tests__/tray-module-hot-rebuild.test.ts] 托盘模块项 0→N 首次出现时整体重建托盘（systray2 不支持运行时增删菜单项）。
  → showModuleError 的"降级红点"若改菜单项，须沿用 `_trayRebuildHook` / `updateTrayModules` 既有重建路径，不得新引第二套重建逻辑。
- [src/tray.ts 现状] showModuleError 三档降级：① node-notifier ② **powershell.exe 气泡（本 sprint 要删的就是这一档）** ③ console.warn。本 sprint 把第 ② 档从 powershell 改为"托盘红点 + 日志"，第 ③ 档保留兜底。

---

## Golden Path

[客户双击 start.vbs] → [VBScript 无窗口拉起 start.bat（windowStyle=0）→ 单实例守卫 → 托盘图标出现] → [模块 preflight 失败 → node-notifier 图形通知 / 降级托盘红点+日志，绝不弹 PowerShell] → [重启后开机自启指向 start.vbs 自动起] → [全程无 cmd/conhost/powershell 可见黑窗，仅托盘图标 + 图形通知感知状态]

---

### Step 1: 客户双击 `start.vbs`，无窗口拉起 Agent
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「双击 start.vbs → VBScript 无窗口拉起 start.bat → 全程无 cmd/conhost 黑窗，几秒后出现托盘图标」

**可观测行为**:
- 安装包内存在新入口 `start.vbs`
- start.vbs 用 `WScript.Shell.Run "<...>\start.bat", 0, False` 拉起 —— 窗口样式 `0`（隐藏）+ `False`（不等待）是"无黑窗"的根因机制
- 真实运行 start.vbs → start.bat 被拉起执行（写入 `%APPDATA%\zenithjoy-agent\launch.log`），过程无可见 cmd/conhost 窗口

**验证命令**（机制层，windows_cloud 可证伪）:
```bash
# 入口存在 + 隐藏窗口样式（Run ..., 0,）
test -f services/agent/install-pack/start.vbs || { echo "FAIL: start.vbs 不存在"; exit 1; }
grep -Eq '\.Run\b.*,[[:space:]]*0[[:space:]]*,' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 未用 windowStyle=0 隐藏窗口启动"; exit 1; }
grep -q 'start\.bat' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 未拉起 start.bat"; exit 1; }
echo OK
```
GHA 真实执行验证见 `## E2E 验收` 脚本 Phase 2（probe 模式真跑 vbs→bat 链，断言 launch.log + start.bat probe 标记写入）。

**硬阈值**: start.vbs 存在；`.Run` 调用 windowStyle 实参 = `0`；E2E probe 模式下 launch.log 与 probe 标记均在脚本启动后写入（时间戳防伪）。

**接缝（真机视觉）**: GHA 非交互桌面无法证明"窗口肉眼不可见"——视觉确认是接缝，见文末「接缝清单 S1」，标 `logic-done-pending`（真目标 = xian-pc 交互桌面双击 + 截图）。

---

### Step 2: 单实例守卫 —— 已运行则不重复拉起
**来源**: `[FROM_PRD]` — 边界情况「已运行时再次启动 → 单实例守卫，不重复拉起（防多开）」+ NFR「单实例」

**可观测行为**: start.vbs 拉起 start.bat 之前，先查 `zenithjoy-agent.exe` 是否在跑；在跑 → 写 launch.log「already running, skip」并 `WScript.Quit`，**不再拉起第二个**。

**验证命令**:
```bash
grep -q 'Win32_Process' services/agent/install-pack/start.vbs \
  && grep -q 'zenithjoy-agent\.exe' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 缺单实例进程探测"; exit 1; }
grep -Eqi 'Quit|skip|already' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 命中已运行未走跳过分支"; exit 1; }
echo OK
```
GHA 真实执行：E2E Phase 3 先起一个假 `zenithjoy-agent.exe` 占位进程，再跑 start.vbs，断言 launch.log 出现 skip 行且未拉起第二个 start.bat。

**硬阈值**: 已运行场景下 launch.log 含 skip 行；start.bat 实例数不增加。

---

### Step 3: 模块 preflight 失败 → 图形通知 / 降级托盘红点，**绝不** PowerShell 闪窗
**来源**: `[FROM_PRD]` — Golden Path 第 3 条 +「不闪 PowerShell 窗口」+ 边界情况「node-notifier 不可用 → 降级托盘红点 + 日志，绝不回退 PowerShell」+ NFR「通知降级」

**可观测行为**:
- `tray.ts` `showModuleError` 第一档走 node-notifier（跨平台图形通知）
- node-notifier 不可用 → 降级"托盘红点 + 日志"（沿用 systray2 重建路径），**不回退 powershell.exe 气泡**
- 整个 `tray.ts` 源码**不再出现 `powershell.exe`**（彻底删掉旧第二档，这是"绝不闪窗"的硬保证）
- 运行期：触发 showModuleError 时**从不 spawn powershell 进程**

**验证命令**（① 硬保证：源码层；② 行为层：运行期不 spawn powershell）:
```bash
# ① 源码绝不含 powershell 通知路径（删干净，不是改名）
grep -q 'powershell' services/agent/src/tray.ts \
  && { echo "FAIL: tray.ts 仍含 powershell 通知路径（未删干净）"; exit 1; } || true
grep -q 'node-notifier' services/agent/src/tray.ts \
  || { echo "FAIL: tray.ts 未走 node-notifier"; exit 1; }

# ② 运行期行为：trap child_process，断言 showModuleError 任何分支都不 spawn powershell
cd services/agent && npx tsx -e '
  const cp = require("node:child_process");
  let psSpawned = false;
  const wrap = (fn) => (...a) => { const c = String(a[0]||""); if (/powershell/i.test(c)) psSpawned = true; return { on(){}, unref(){} }; };
  cp.execFile = wrap(cp.execFile); cp.spawn = wrap(cp.spawn); cp.exec = wrap(cp.exec);
  const t = require("./src/tray.ts");
  t.showModuleError("微信 AI 客服","需要安装微信");   // node-notifier 档（或降级，均不应碰 powershell）
  if (psSpawned) { console.error("FAIL: showModuleError spawned powershell"); process.exit(1); }
  console.log("OK");
' || { echo "FAIL: 运行期 showModuleError 触发了 powershell"; exit 1; }
echo OK
```

**硬阈值**: `grep powershell tray.ts` 命中数 = 0；运行期 powershell spawn 计数 = 0；tray.ts 含 node-notifier 调用 + 降级红点+日志路径。

**接缝（真机视觉）**: "图形通知真的弹在屏幕上 / 降级红点肉眼可见"是接缝（GHA headless 不渲染 toast）——见「接缝清单 S2」，标 `logic-done-pending`（真目标 = xian-pc 触发 preflight 失败看到 toast / 红点）。

---

### Step 4: 重启后开机自启指向 start.vbs，自动起 Agent
**来源**: `[FROM_PRD]` — Golden Path 第 4 条「重启电脑 → 开机自启项指向 start.vbs，Agent 自动起来连中台」+ NFR「开机自启」

**可观测行为**: `install-autostart.ps1` 注册的开机任务目标从 `start.bat` 改为 `start.vbs`（无窗口入口），开机即无窗口自起。

**验证命令**:
```bash
grep -q 'start\.vbs' services/agent/install-pack/install-autostart.ps1 \
  || { echo "FAIL: install-autostart.ps1 未指向 start.vbs"; exit 1; }
# 不得仍把 start.bat 当 $Target（防只加未改）
grep -Eq "Target\s*=.*start\.bat'" services/agent/install-pack/install-autostart.ps1 \
  && { echo "FAIL: 自启目标仍是 start.bat"; exit 1; } || true
echo OK
```

**硬阈值**: 自启脚本 `$Target` 指向 start.vbs。

**接缝（真机重启）**: "重启后真自动起来连中台"是接缝——见「接缝清单 S3」，标 `logic-done-pending`（真目标 = xian-pc 重启验证）。

---

### Step 5: launch.log 大小轮转
**来源**: `[FROM_PRD]` — 边界情况「launch.log 无限增长 → 大小轮转」+ NFR「日志：launch.log 限大小轮转」

**可观测行为**: start.vbs 写日志前检查 `%APPDATA%\zenithjoy-agent\launch.log` 大小，超阈值（1MB）即截断/删除重建，防无限增长。

**验证命令**:
```bash
grep -Eq '1048576|\.Size|GetFile' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 缺 launch.log 大小轮转"; exit 1; }
grep -q 'launch\.log' services/agent/install-pack/start.vbs \
  || { echo "FAIL: start.vbs 未写 launch.log"; exit 1; }
echo OK
```
GHA 真实执行：E2E Phase 4 预置一个 >1MB 的 launch.log，跑 start.vbs（probe），断言日志被轮转（大小回落到阈值以下）。

**硬阈值**: 预置 >1MB 日志 → 运行后 < 1MB。

---

### Step 6: start.vbs 打包进 install-pack
**来源**: `[FROM_PRD]` — 范围「打包进 install-pack」+ 预期受影响文件 `build-install-pack.sh`

**可观测行为**: `build-install-pack.sh` 把 `start.vbs` 拷进产物目录（正式 + dryrun 两条路径都拷），客户拿到的包里含 start.vbs。

**验证命令**:
```bash
grep -q 'install-pack/start\.vbs' services/agent/scripts/build-install-pack.sh \
  || { echo "FAIL: build-install-pack.sh 未拷 start.vbs"; exit 1; }
echo OK
```
GHA 真实执行：E2E Phase 1 跑 `build-install-pack.sh --dryrun`，断言 `$PACK_DIR/start.vbs` 存在。

**硬阈值**: dryrun 产物含 start.vbs。

---

### Step 7: node-notifier 依赖落地
**来源**: `[FROM_PRD]` — 假设「node-notifier 通过本 sprint `npm i node-notifier` 安装」+ 预期受影响文件 `package.json`

**可观测行为**: `services/agent/package.json` dependencies 含 `node-notifier`。

**验证命令**:
```bash
node -e 'const p=require("./services/agent/package.json"); if(!(p.dependencies&&p.dependencies["node-notifier"]))process.exit(1)' \
  || { echo "FAIL: package.json 缺 node-notifier 依赖"; exit 1; }
echo OK
```

**硬阈值**: dependencies["node-notifier"] 存在。

---

## 接缝清单（真实世界触点 — 真机校准/真验，未真验标 logic-done-pending）

> 本 sprint 的核心价值（无黑窗 / 图形通知 / 重启自起）有 3 个点碰真实交互桌面，GHA windows-latest 是**非交互 headless** 会话，只能证明"机制正确"，无法证明"视觉效果"。机制层在 GHA 真验（见 E2E）；视觉/重启层是接缝，必须在真目标（xian-pc 产品形态客户机样本，CLAUDE.md 指定）真验后才能标 done，否则标 `logic-done-pending`。

| 接缝 | 碰真实世界的点 | GHA 能验（机制，已 done） | 真目标验证方式（接缝，logic-done-pending） |
|---|---|---|---|
| **S1 无黑窗** | 双击 start.vbs 后客户屏幕上无任何 cmd/conhost 可见窗口 | start.vbs 用 `.Run ...,0,False` 隐藏样式 + probe 真跑 vbs→bat 链成功 | xian-pc 交互桌面双击 start.vbs，截图/肉眼确认无黑窗 |
| **S2 图形通知** | preflight 失败时 toast/红点真弹在屏幕 | tray.ts 删尽 powershell + 运行期 0 次 powershell spawn + node-notifier 可调 | xian-pc 触发 preflight 失败，截图确认 toast 弹出 / 降级红点可见、无 PowerShell 闪窗 |
| **S3 重启自起** | 重启电脑后 Agent 经 start.vbs 自动起并连中台 | install-autostart.ps1 $Target 指向 start.vbs | xian-pc 重启，确认 Agent 无窗口自起 + 中台 module-health 收到 heartbeat |

> **禁止写死环境假设值**：start.vbs 的日志路径用 `%APPDATA%` 环境推导（不写死绝对路径）；轮转阈值 1MB 为显式常量（非屏幕坐标类假设值，可接受）；单实例探测走 WMI 真实进程表（非假设）。

---

## E2E 验收（target_environment = windows_cloud — `${SPRINT_DIR}/e2e-verify.ps1`，GHA windows-latest 执行）

> 由 evaluator 模式 B dispatch `e2e-windows.yml`（已存在，runs-on windows-latest，执行 `$sprintDir/e2e-verify.ps1`）。
> 脚本只验**可证伪的机制层**：① 打包含 start.vbs ② 真跑 vbs→bat 隐藏链（probe 模式，断言 launch.log + probe 标记，时间戳防伪）③ 单实例跳过 ④ launch.log 轮转 ⑤ tray.ts 零 powershell。视觉/重启接缝见上「接缝清单」，不在 GHA 断言。
> **probe 模式**：start.bat 顶部加 `if defined ZJ_LAUNCH_PROBE (... 写 probe 标记 + exit /b 0)` 早退守卫（test seam，不 mock 启动链本身——vbs→bat 拉起机制全真），避免 GHA 上 start.bat 跑完整重活/`pause` 挂死。

```powershell
# e2e-verify.ps1 — Agent 客户端封装 去黑窗+静默通知（windows_cloud / GHA windows-latest）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ScriptStart = Get-Date                       # 时间戳防伪基准
$repo = Resolve-Path "$PSScriptRoot\..\.."    # sprints/<x>/ → repo root
$agentDir = "$repo\services\agent"
$logDir = "$env:APPDATA\zenithjoy-agent"
$launchLog = "$logDir\launch.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Remove-Item $launchLog -ErrorAction SilentlyContinue

# ---- Phase 1: 打包产物含 start.vbs（dryrun，跨平台 bash 经 git-bash）----
Write-Host "▶ Phase 1: build-install-pack 含 start.vbs"
$pack = "$env:TEMP\zj-pack-test"
& bash -lc "cd '$agentDir' && CUSTOM_OUT='$($pack -replace '\\','/')' bash scripts/build-install-pack.sh --dryrun" 2>&1 | Select-Object -Last 8
if (-not (Test-Path "$pack\start.vbs")) { throw "FAIL: dryrun 产物缺 start.vbs" }
Write-Host "  ✅ 产物含 start.vbs"

# ---- Phase 2: 真跑 start.vbs → start.bat 隐藏链（probe 模式）----
Write-Host "▶ Phase 2: vbs 隐藏拉起 bat（probe）"
$probeMarker = "$logDir\probe-marker.txt"
Remove-Item $probeMarker -ErrorAction SilentlyContinue
$env:ZJ_LAUNCH_PROBE = "1"                     # start.bat 顶部守卫：写 probe 标记 + exit /b 0
# 用真实 install-pack 目录跑（start.vbs 同目录须有 start.bat）
Copy-Item "$agentDir\install-pack\start.vbs" "$pack\" -Force
& wscript.exe "$pack\start.vbs"               # Run(...,0,False) 立即返回
$ok = $false
for ($i=0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if ((Test-Path $launchLog) -and (Select-String -Path $launchLog -Pattern 'launch' -Quiet)) { $ok = $true; break }
}
if (-not $ok) { throw "FAIL: launch.log 未出现拉起记录（vbs 未隐藏拉起 bat）" }
# probe 标记证明 vbs→bat 链真执行（不是 vbs 自说自话）
if (-not (Test-Path $probeMarker)) { throw "FAIL: start.bat probe 标记缺失，vbs→bat 链未真执行" }
# 时间戳防伪：本轮产物须晚于脚本启动
if ((Get-Item $launchLog).LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: launch.log 为历史遗留冒充" }
# 进程层：拉起期间不得有带可见主窗口的 cmd/conhost（GHA 上恒为 0，仅作回归守卫）
$visible = Get-Process cmd,conhost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($visible) { throw "FAIL: 出现可见 cmd/conhost 窗口" }
Write-Host "  ✅ vbs 隐藏拉起 bat 成功，launch.log + probe 标记均本轮写入"

# ---- Phase 3: 单实例守卫（已运行则跳过）----
Write-Host "▶ Phase 3: 单实例守卫"
Remove-Item $launchLog -ErrorAction SilentlyContinue
$fake = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-Command","`$Host.UI.RawUI.WindowTitle='zenithjoy-agent'; Start-Sleep 30" -PassThru -WindowStyle Hidden
# 用临时改名模拟 zenithjoy-agent.exe 在跑：起一个真名进程占位
$stubExe = "$env:TEMP\zenithjoy-agent.exe"
Copy-Item "$env:SystemRoot\System32\timeout.exe" $stubExe -Force
$stub = Start-Process -FilePath $stubExe -ArgumentList "/t","30","/nobreak" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1
& wscript.exe "$pack\start.vbs"
Start-Sleep -Seconds 2
$skipped = (Test-Path $launchLog) -and (Select-String -Path $launchLog -Pattern 'skip|already' -Quiet)
Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
Remove-Item $stubExe -ErrorAction SilentlyContinue
if (-not $skipped) { throw "FAIL: 已运行时未跳过（单实例失效）" }
Write-Host "  ✅ 单实例守卫生效（已运行 → skip）"

# ---- Phase 4: launch.log 大小轮转 ----
Write-Host "▶ Phase 4: launch.log 轮转"
Remove-Item "$env:TEMP\zenithjoy-agent.exe" -ErrorAction SilentlyContinue
$big = New-Object byte[] (1100000)            # >1MB
[IO.File]::WriteAllBytes($launchLog, $big)
& wscript.exe "$pack\start.vbs"
Start-Sleep -Seconds 2
$sz = (Get-Item $launchLog).Length
if ($sz -ge 1048576) { throw "FAIL: launch.log 未轮转 size=$sz" }
Write-Host "  ✅ launch.log 已轮转 size=$sz"

# ---- Phase 5: tray.ts 零 powershell（去黑窗硬保证）----
Write-Host "▶ Phase 5: tray.ts 无 powershell 通知路径"
if (Select-String -Path "$agentDir\src\tray.ts" -Pattern 'powershell' -Quiet) {
  throw "FAIL: tray.ts 仍含 powershell（未删干净，可能闪窗）"
}
if (-not (Select-String -Path "$agentDir\src\tray.ts" -Pattern 'node-notifier' -Quiet)) {
  throw "FAIL: tray.ts 未走 node-notifier"
}
Write-Host "  ✅ tray.ts 零 powershell + 走 node-notifier"

Remove-Item Env:\ZJ_LAUNCH_PROBE -ErrorAction SilentlyContinue
Write-Host "✅ windows_cloud E2E 全部通过（机制层；视觉/重启接缝见 contract 接缝清单，logic-done-pending）"
exit 0
```

**PASS 标准**: 脚本 exit 0（5 个 Phase 全过）
**FAIL 标准**: 任一 Phase throw / exit≠0
**GHA workflow**: `.github/workflows/e2e-windows.yml`（已存在，workflow_dispatch + windows-latest，执行 `$sprintDir/e2e-verify.ps1`）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（去黑窗+静默通知） | `tests/agent-client-encapsulation.test.ts` | start.vbs 隐藏入口 / 单实例 / 日志轮转 / tray 去 powershell+node-notifier / 自启指向 vbs / 打包含 vbs / node-notifier 依赖 | start.vbs 不存在、tray.ts 含 powershell、自启指 start.bat、package.json 无 node-notifier、build 脚本未拷 vbs → 多条 FAIL |
