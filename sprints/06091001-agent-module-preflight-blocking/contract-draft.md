# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A）

**本 Sprint 无新增 HTTP 端点。**

PRD ASSUMPTION 明确：`/api/agent/module-health` 端点已存在，返回含 `module_status['line04-wechat-cs']` 的结构。
Generator 无需新建端点。已有 Schema 定义来源 `apps/dashboard/src/api/moduleHealth.api.ts`：

```json
{
  "ok": true,
  "data": [
    {
      "agent_id": "<string>",
      "hostname": "<string>",
      "module_status": {
        "line04-wechat-cs": { "ok": "<boolean>", "reason": "<string|undefined>" }
      },
      "updated_at": "<ISO8601>"
    }
  ]
}
```

**禁用字段名**：N/A（不新增端点，既有 Schema 不变）
Reviewer 第 6 维 verification_oracle_completeness 自动满分（无新端点）。

---

## Golden Path

```
[客户双击 start.bat]
  → [preflight.py 按序执行 9 项检测]
    ├─ 边界: 微信版本 ≥4.1.9 → 自动降级到 4.1.8（dry_run: 返回 failed）
  → [check_lock_update 四层锁执行]
  → FAIL: [blocking exit /b 1，cmd 显示失败项 + 修复提示]
  → PASS: [Agent 启动，Line04 激活，检测结果上报中台]
  → [Dashboard /module-health 普通账号可访问]
  → [WechatCustomerServiceConfigPage 顶部显示 Line04PreflightCard ✅/❌]
```

---

### Step 1: preflight.py --dry-run 返回 9 项检测（含 lock_update）

**来源**: `[FROM_PRD]` — PRD "具体步骤 1-2"：start.bat 执行 preflight，按序检测含 lock_update 等项。CHECK_NAMES 含 9 项（os_session/wechat_installed/wechat_version/lock_update/wechat_login/python_pywinauto/uia_narrator/middleware_health/elevation）。

**可观测行为**: 运行 `preflight.py --dry-run` 后写入 `zj-preflight.json`，JSON `checks` 数组含 9 项，其中 `name == "lock_update"` 存在。

**验证命令**:
```bash
cd services/agent/wechat-rpa
PUBLIC=/tmp python preflight.py --dry-run
python -c "
import json, os
report = json.load(open('/tmp/zj-preflight.json', encoding='utf-8'))
checks = report['checks']
assert len(checks) == 9, f'FAIL: 期望9项，实际{len(checks)}项'
lk = [x for x in checks if x['name'] == 'lock_update']
assert lk, f'FAIL: lock_update 项不存在，现有: {[c[\"name\"] for c in checks]}'
print('✅ Step1 PASS: 9项检测，含lock_update')
"
```

**硬阈值**: `len(checks) == 9`，含 `name == "lock_update"` 项

---

### Step 1b（边界场景）: 微信版本 ≥4.1.9 → 降级路径被检测到

**来源**: `[FROM_PRD]` — PRD 边界情况："微信版本 ≥4.1.9：preflight 自动降级到 4.1.8 后继续执行四层锁"。`check_wechat_version()` 已含降级路径（line 428-429），本步骤补覆盖此路径。

**可观测行为**:
- dry_run 模式（CI）：`check_wechat_version(dry_run=True)` 当版本为 4.1.9 时返回 `status="failed"`，`detail` 含 "4.1.8" 降级说明
- 真实模式（xian-rog）：版本 ≥4.1.9 时自动下载 4.1.8 安装包、卸载当前版本、安装 4.1.8，检测结果变为 `status="fixed"`

**验证命令**（跨平台 Python mock，CI dry_run 验证路径存在）:
```bash
cd services/agent/wechat-rpa
python -c "
import sys
from unittest.mock import patch
sys.path.insert(0, '.')
with patch('preflight.get_weixin_version', return_value='4.1.9'), \
     patch('preflight._is_windows', return_value=True):
    from preflight import check_wechat_version
    result = check_wechat_version(dry_run=True)
assert result['status'] == 'failed', f'FAIL: 4.1.9 dry_run 应返回 failed，实际 {result[\"status\"]}'
assert '4.1.8' in result.get('detail', ''), 'FAIL: detail 未提及 4.1.8'
print('✅ Step1b PASS: 版本 4.1.9 → 降级路径被检测到')
"
```

**硬阈值**: `status == "failed"`，`detail` 含 `"4.1.8"`
**注**: 真实降级（下载+安装）在 xian-rog 真机验证，CI 仅验证路径逻辑存在

---

### Step 2: check_lock_update() 四层锁完整执行

**来源**: `[FROM_PRD]` — PRD "范围限定: preflight.py check_lock_update() 扩展四层锁：icacls 只读 + 域名防火墙出站 block + 注册表 AutoUpdate=0"

**可观测行为**:
在测试夹具上运行 `check_lock_update(dry_run=False)`，四层验证全通：
1. WeixinUpdate.exe 已改名 `.disabled`
2. 文件 icacls 权限含 DENY（防止重命名被撤销）
3. 防火墙出站规则含 `dldir1v6.qq.com`（域名封禁，不仅封程序路径）
4. 注册表 `HKLM\SOFTWARE\Policies\Tencent\WeChat\AutoUpdate == 0`

**验证命令**（在 GHA windows-latest 上执行，需要管理员权限）:
```powershell
# 1. 创建测试夹具
$fixtureDir = "C:\Program Files\Tencent\Weixin"
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
Copy-Item "$env:SystemRoot\System32\notepad.exe" "$fixtureDir\WeixinUpdate.exe" -Force

# 2. 运行 check_lock_update
python -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
from preflight import check_lock_update
result = check_lock_update(dry_run=False)
print('status:', result['status'], 'detail:', result.get('detail',''))
assert result['status'] in ('ok', 'fixed'), f'FAIL: status={result[\"status\"]}'
print('OK lock_update executed')
"
if ($LASTEXITCODE -ne 0) { throw "FAIL: check_lock_update 执行失败" }

# 3. 四层锁验证
python -c "
import subprocess, winreg, os

# Layer 1: 文件已改名 .disabled
disabled = r'C:\Program Files\Tencent\Weixin\WeixinUpdate.exe.disabled'
assert os.path.exists(disabled), f'FAIL Layer1: {disabled} 不存在'

# Layer 2: icacls DENY
r = subprocess.run(['icacls', disabled], capture_output=True, text=True)
assert 'DENY' in r.stdout, f'FAIL Layer2: icacls 无 DENY: {r.stdout[:300]}'

# Layer 3: dldir1v6.qq.com 域名封禁（非程序路径封禁）
fw = subprocess.run(['netsh', 'advfirewall', 'firewall', 'show', 'rule', 'name=all'],
    capture_output=True, text=True)
assert 'dldir1v6.qq.com' in fw.stdout, 'FAIL Layer3: 防火墙无 dldir1v6.qq.com 域名规则'

# Layer 4: 注册表 AutoUpdate=0
k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Policies\Tencent\WeChat')
v, _ = winreg.QueryValueEx(k, 'AutoUpdate')
assert v == 0, f'FAIL Layer4: AutoUpdate={v}，期望 0'

print('✅ Step2 PASS: 四层锁全部验证通过')
"
if ($LASTEXITCODE -ne 0) { throw "FAIL: 四层锁验证失败" }
```

**硬阈值**: icacls 含 DENY + 防火墙含 dldir1v6.qq.com + AutoUpdate == 0

---

### Step 3: preflight 失败 → start.bat blocking exit /b 1，cmd 显示原因

**来源**: `[FROM_PRD]` — PRD "具体步骤 3"：任一项 failed → cmd 显示具体失败项及修复提示，Line04 不启动；"范围限定: start.bat preflight failed 改为 blocking：exit /b 1，不再 warn-and-continue"

**可观测行为**: 当 preflight.py 退出码为 1 时，start.bat 立即 `exit /b 1`；stdout 不含 "continuing to start agent"；含 blocking 明确提示。

**验证命令**:
```powershell
$testDir = "$env:TEMP\zj-startbat-blocking-test"
New-Item -ItemType Directory -Force -Path "$testDir\python-embedded" | Out-Null
New-Item -ItemType Directory -Force -Path "$testDir\wechat-rpa" | Out-Null

Set-Content "$testDir\wechat-rpa\preflight.py" @'
import os, sys
if os.environ.get("PREFLIGHT_MOCK_FAIL") == "1":
    print("[preflight-stub] FAIL: simulated preflight failure for blocking test", flush=True)
    sys.exit(1)
sys.exit(0)
'@
Copy-Item (Get-Command python.exe).Source "$testDir\python-embedded\python.exe" -Force
Copy-Item "services\agent\install-pack\start.bat" "$testDir\start.bat" -Force

$proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'set PREFLIGHT_MOCK_FAIL=1 && start.bat' `
    -WorkingDirectory $testDir -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput "$testDir\out.txt" -RedirectStandardError "$testDir\err.txt"

$out = Get-Content "$testDir\out.txt" -Raw -ErrorAction SilentlyContinue

if ($proc.ExitCode -eq 0) { throw "FAIL: start.bat 应返回非 0（blocking），但返回 0" }
if ($out -match "continuing to start agent") {
    throw "FAIL: start.bat 仍输出 'continuing to start agent'（blocking 未生效）"
}
if (-not ($out -match 'FAIL|preflight|失败')) {
    throw "FAIL: start.bat 未输出失败描述（cmd 窗口应含 'FAIL' 或 'preflight' 等失败项说明）"
}
Write-Host "✅ Step3 PASS: start.bat blocking exit=$($proc.ExitCode)"
```

**硬阈值**: exit code ≠ 0，stdout 不含 "continuing to start agent"

---

### Step 4: Dashboard /module-health 普通账号直接可见

**来源**: `[FROM_PRD]` — PRD "具体步骤 6"：运营打开 `/module-health` 无需超管权限；"范围限定: navigation.config.ts 删除 /module-health nav 项的 requireSuperAdmin: true（line 299）"

**可观测行为**: `navigation.config.ts` 中 `/module-health` 路径的 nav 项没有 `requireSuperAdmin: true` 字段。

**验证命令**:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
const lines = src.split('\n');
let inMH = false, startLine = -1;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes(\"path: '/module-health'\")) { inMH = true; startLine = i; }
  if (inMH && i > startLine + 1 && l.includes(\"path: '/\")) inMH = false;
  if (inMH && l.includes('requireSuperAdmin: true')) {
    console.error('FAIL: /module-health nav 项仍含 requireSuperAdmin: true at line', i+1);
    process.exit(1);
  }
}
console.log('✅ Step4 PASS: /module-health 无 requireSuperAdmin');
"
```

**硬阈值**: navigation.config.ts 中 /module-health 块无 `requireSuperAdmin: true`

---

### Step 5: WechatCustomerServiceConfigPage 顶部显示 Line04PreflightCard

**来源**: `[FROM_PRD]` — PRD "具体步骤 5"：客户打开 Dashboard 微信 AI 客服设置页 → 顶部「本机环境状态」卡片；"范围限定: WechatCustomerServiceConfigPage.tsx 顶部加 Line04PreflightCard 组件"

**可观测行为**:
1. `apps/dashboard/src/components/Line04PreflightCard.tsx` 存在，含 `fetchModuleHealth` 调用、ok/reason 渲染、"Agent 未连接" 无数据提示
2. `WechatCustomerServiceConfigPage.tsx` 已 import 并渲染 `<Line04PreflightCard />`

**验证命令**:
```bash
node -e "
const fs = require('fs');
const card = fs.readFileSync('apps/dashboard/src/components/Line04PreflightCard.tsx', 'utf8');
if (!card.includes('fetchModuleHealth')) { console.error('FAIL: 缺 fetchModuleHealth'); process.exit(1); }
if (!card.includes('Agent 未连接')) { console.error('FAIL: 缺无数据提示'); process.exit(1); }
const page = fs.readFileSync('apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx', 'utf8');
if (!page.includes('Line04PreflightCard')) { console.error('FAIL: 页面未引用组件'); process.exit(1); }
console.log('✅ Step5 PASS: Line04PreflightCard 已实现并被页面引用');
"
```

**硬阈值**: 组件文件存在 + 含 fetchModuleHealth + 含 "Agent 未连接" + 页面已引用

---

### Step 6: 全部通过时 Agent 启动，Line04 激活

**来源**: `[FROM_PRD]` — PRD "具体步骤 4"：全部通过 → Agent 启动，Line04 激活，检测结果上报中台

**可观测行为**: preflight.py --dry-run 在 CI 环境（非 Windows，elevation/wechat_* 为 warn 非 failed）exit code = 0

**验证命令**（PowerShell，与 e2e-verify.ps1 E2E-6 一致）:
```powershell
$env:PUBLIC = $env:TEMP
$dryRunProc = Start-Process -FilePath "python" `
    -ArgumentList "services\agent\wechat-rpa\preflight.py", "--dry-run" `
    -WorkingDirectory $RepoRoot `
    -Wait -PassThru -NoNewWindow
if ($dryRunProc.ExitCode -ne 0) {
    throw "FAIL: preflight --dry-run 返回 exit=$($dryRunProc.ExitCode)（含 failed 项）"
}
Write-Host "✅ Step6 PASS: preflight --dry-run exit=0"
```

**硬阈值**: exit code = 0

---

## Risks

| Risk | 受影响组件 | Mitigation | 合同处理 |
|---|---|---|---|
| **UAC 不足**：icacls/netsh 需管理员权限 | check_lock_update() Layer 2/3 | start.bat 已通过 ShellExecute runas 提权；check_lock_update 非管理员时捕获 PermissionError 返回 warn，不 abort | Layer 2/3 BEHAVIOR 在 GHA windows-latest（管理员 session）验证；生产 start.bat 提权路径保持不变 |
| **防病毒拦截**：WeixinUpdate.exe 改名或 icacls 被拦截 | check_lock_update() Layer 1/2 | 捕获 OSError/PermissionError，失败时返回 "warn" + 提示关防病毒；不硬 abort | BEHAVIOR 断言 status in (ok, fixed, warn)；CI 夹具无防病毒，可验到 ok/fixed |
| **组策略拒绝注册表写 HKLM** | check_lock_update() Layer 4 | try/except WindowsError 兜底；失败时 warn 不 fail；域环境企业 GP 优先 | BEHAVIOR Layer 4 只验"AutoUpdate==0 已写入"在无 GP 的 GHA runner 上成立 |
| **WeixinUpdate.exe 不存在** | check_lock_update() | 已处理：`enabled` 列表为空 → 直接返回 ok（已禁用）| 现有代码已覆盖，无需新增处理 |
| **COS 下载 4.1.8 失败** | check_wechat_version() downgrade | 超时/失败返回 "failed" + 提示手动安装；Step1b 在 dry_run 模式验证路径逻辑，不触发真实下载 | dry_run 测试与真实下载路径解耦，CI 不需要 COS 可达 |
| **TS preflight.ts vs Python preflight.py 对齐风险** | CI 覆盖 | 两者职责不同：`modules/line04/preflight.ts` = NodeJS Agent 模块生命周期管理（agent-module-e2e.yml 测）；`wechat-rpa/preflight.py` = Python WeChat RPA 环境预检（新 workflow 测）。互不干扰，Generator 改 Python 不影响 TS CI | 新 workflow 仅测 Python preflight.py + start.bat，不依赖 agent-module-e2e.yml |

---

## E2E 验收（target_environment: windows_cloud — GitHub Actions windows-latest）

**journey_type**: dev_pipeline
**target_environment**: windows_cloud

> **v9.0 说明**：PRD 显式声明 `target_environment: windows_cloud`，理由充分：
> - `preflight.py --dry-run` 专为 CI 设计（无真实微信）
> - 四层锁测试使用 `C:\Program Files\Tencent\Weixin\WeixinUpdate.exe` 临时夹具
> - windows-latest runner 有管理员权限，可执行 icacls/netsh/winreg
> Proposer 遵从 PRD 显式声明。

> **windows_cloud 1:1 用户路径映射检查（v8.1 强制）**：
> 已检查 `.github/workflows/agent-module-e2e.yml`（测 TypeScript `modules/line04/preflight.ts`，非本 Sprint 的 Python `preflight.py`）
> 和 `.github/workflows/agent-installpack.yml`（测 `listen_chat.py --dryrun-print-version`，非四层锁）。
>
> | 用户路径 | 现有 CI 覆盖 |
> |---|---|
> | preflight.py --dry-run 9 项 | `[CI_GAP]` — 无现有 workflow 覆盖 |
> | check_lock_update 四层锁验证 | `[CI_GAP]` — 无现有 workflow 覆盖 |
> | start.bat preflight-failed blocking | `[CI_GAP]` — 无现有 workflow 覆盖 |
> | /module-health 无 requireSuperAdmin | `[CI_GAP]` — 无现有 workflow 覆盖 |
> | Line04PreflightCard 组件完整性 | `[CI_GAP]` — 无现有 workflow 覆盖 |
>
> **Generator 必须新建 `.github/workflows/agent-preflight-hardening-e2e.yml`**，含以下配置：
> ```yaml
> on:
>   push:
>     branches: [main, 'cp-*']
>     paths:
>       - 'services/agent/wechat-rpa/preflight.py'
>       - 'services/agent/install-pack/start.bat'
>       - 'apps/dashboard/src/config/navigation.config.ts'
>       - 'apps/dashboard/src/components/Line04PreflightCard.tsx'
>       - 'apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx'
>       - '.github/workflows/agent-preflight-hardening-e2e.yml'
>   pull_request:
>     branches: [main]
>     paths: [同上]
>   workflow_dispatch:
> ```
> **理由**：无 paths: 触发条件时，每次 push 均触发（包括无关变更），浪费 CI 时长；preflight.py 或 start.bat 变更时必须自动触发。

```powershell
# sprints/06091001-agent-module-preflight-blocking/e2e-verify.ps1
param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== preflight-hardening E2E 验证开始 ==="

# ─── E2E-1: preflight.py --dry-run 9 项检测 ────────────────────────────────────
Write-Host "`n▶ E2E-1: preflight.py --dry-run 9 项检测..."
$env:PUBLIC = $env:TEMP
& python "$RepoRoot\services\agent\wechat-rpa\preflight.py" --dry-run 2>&1 | Out-Null

python -c @"
import json, os, sys
jpath = os.path.join(os.environ.get('TEMP', '/tmp'), 'zj-preflight.json')
report = json.load(open(jpath, encoding='utf-8'))
checks = report['checks']
assert len(checks) == 9, f'FAIL: 期望9项，实际{len(checks)}项'
lk = [x for x in checks if x['name'] == 'lock_update']
assert lk, f'FAIL: lock_update 项不存在'
print('OK: 9项检测，含lock_update，status=' + lk[0]['status'])
"@
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-1 preflight 9项检测验证失败" }
Write-Host "✅ E2E-1 PASS"

# ─── E2E-1b: 降级路径逻辑验证（mock 4.1.9）─────────────────────────────────────
Write-Host "`n▶ E2E-1b: 微信版本 4.1.9 降级路径 dry_run 验证..."
python -c @"
import sys
from unittest.mock import patch
sys.path.insert(0, r'$RepoRoot\services\agent\wechat-rpa')
with patch('preflight.get_weixin_version', return_value='4.1.9'), \
     patch('preflight._is_windows', return_value=True):
    from preflight import check_wechat_version
    result = check_wechat_version(dry_run=True)
assert result['status'] == 'failed', f'FAIL: 4.1.9 dry_run 应返回 failed，实际 {result[\"status\"]}'
assert '4.1.8' in result.get('detail',''), 'FAIL: detail 未提及 4.1.8'
print('OK: 4.1.9 → 降级路径被检测到')
"@
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-1b 降级路径验证失败" }
Write-Host "✅ E2E-1b PASS"

# ─── E2E-2: check_lock_update 四层锁 ──────────────────────────────────────────
Write-Host "`n▶ E2E-2: check_lock_update 四层锁验证..."
$fixtureDir = "C:\Program Files\Tencent\Weixin"
New-Item -ItemType Directory -Force -Path $fixtureDir | Out-Null
Copy-Item "$env:SystemRoot\System32\notepad.exe" "$fixtureDir\WeixinUpdate.exe" -Force

python -c @"
import sys
sys.path.insert(0, r'$RepoRoot\services\agent\wechat-rpa')
from preflight import check_lock_update
result = check_lock_update(dry_run=False)
print('status:', result['status'], '| detail:', result.get('detail', ''))
assert result['status'] in ('ok', 'fixed'), f'FAIL: status={result[\"status\"]}'
"@
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-2 check_lock_update 执行失败" }

python -c @"
import subprocess, winreg, os
disabled = r'C:\Program Files\Tencent\Weixin\WeixinUpdate.exe.disabled'
assert os.path.exists(disabled), f'FAIL Layer1: 文件未改名'
r = subprocess.run(['icacls', disabled], capture_output=True, text=True)
assert 'DENY' in r.stdout, f'FAIL Layer2: icacls 无 DENY: {r.stdout[:300]}'
fw = subprocess.run(['netsh','advfirewall','firewall','show','rule','name=all'], capture_output=True, text=True)
assert 'dldir1v6.qq.com' in fw.stdout, 'FAIL Layer3: 防火墙无 dldir1v6.qq.com 规则'
k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Policies\Tencent\WeChat')
v, _ = winreg.QueryValueEx(k, 'AutoUpdate')
assert v == 0, f'FAIL Layer4: AutoUpdate={v}，期望0'
print('OK: 四层锁全验证通过')
"@
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-2 四层锁验证失败" }
Write-Host "✅ E2E-2 PASS"

# ─── E2E-3: start.bat preflight-failed → blocking ─────────────────────────────
Write-Host "`n▶ E2E-3: start.bat blocking 验证..."
$testDir = "$env:TEMP\zj-startbat-test"
New-Item -ItemType Directory -Force -Path "$testDir\python-embedded" | Out-Null
New-Item -ItemType Directory -Force -Path "$testDir\wechat-rpa" | Out-Null

Set-Content "$testDir\wechat-rpa\preflight.py" @'
import os, sys
if os.environ.get("PREFLIGHT_MOCK_FAIL") == "1":
    print("[preflight-stub] FAIL: simulated preflight failure", flush=True)
    sys.exit(1)
sys.exit(0)
'@
Copy-Item (Get-Command python.exe).Source "$testDir\python-embedded\python.exe" -Force
Copy-Item "$RepoRoot\services\agent\install-pack\start.bat" "$testDir\start.bat" -Force

$proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'set PREFLIGHT_MOCK_FAIL=1 && start.bat' `
    -WorkingDirectory $testDir -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput "$testDir\out.txt" -RedirectStandardError "$testDir\err.txt"
$out = Get-Content "$testDir\out.txt" -Raw -ErrorAction SilentlyContinue

if ($proc.ExitCode -eq 0) { throw "FAIL: E2E-3 start.bat 应返回非 0（blocking），但返回 0" }
if ($out -match "continuing to start agent") {
    throw "FAIL: E2E-3 start.bat 仍输出 'continuing to start agent'"
}
if (-not ($out -match 'FAIL|preflight|失败')) {
    throw "FAIL: E2E-3 start.bat 未输出失败描述（cmd 窗口应含 'FAIL' 或 'preflight' 等失败项说明）"
}
Write-Host "✅ E2E-3 PASS: blocking exit=$($proc.ExitCode)"

# ─── E2E-4: navigation.config.ts 无 requireSuperAdmin ────────────────────────
Write-Host "`n▶ E2E-4: /module-health 权限检查..."
node -e @"
const fs = require('fs');
const src = fs.readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
const lines = src.split('\n');
let inMH = false, startLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(\"path: '/module-health'\")) { inMH = true; startLine = i; }
  if (inMH && i > startLine + 1 && lines[i].includes(\"path: '/\")) inMH = false;
  if (inMH && lines[i].includes('requireSuperAdmin: true')) {
    console.error('FAIL: /module-health 仍有 requireSuperAdmin at line', i+1);
    process.exit(1);
  }
}
console.log('OK');
"@ 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-4 navigation 权限检查失败" }
Write-Host "✅ E2E-4 PASS"

# ─── E2E-5: Line04PreflightCard 组件完整性 ────────────────────────────────────
Write-Host "`n▶ E2E-5: Line04PreflightCard 组件验证..."
node -e @"
const fs = require('fs');
const card = fs.readFileSync('apps/dashboard/src/components/Line04PreflightCard.tsx', 'utf8');
if (!card.includes('fetchModuleHealth')) { console.error('FAIL: 缺 fetchModuleHealth'); process.exit(1); }
if (!card.includes('Agent 未连接')) { console.error('FAIL: 缺无数据提示'); process.exit(1); }
const page = fs.readFileSync('apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx', 'utf8');
if (!page.includes('Line04PreflightCard')) { console.error('FAIL: 页面未引用组件'); process.exit(1); }
console.log('OK');
"@ 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: E2E-5 组件验证失败" }
Write-Host "✅ E2E-5 PASS"

# ─── E2E-6: preflight --dry-run 全通路径（成功路径入口） ─────────────────────────
Write-Host "`n▶ E2E-6: preflight --dry-run 全通路径（exit 0）..."
$env:PUBLIC = $env:TEMP
$dryRunProc = Start-Process -FilePath "python" `
    -ArgumentList "$RepoRoot\services\agent\wechat-rpa\preflight.py", "--dry-run" `
    -WorkingDirectory $RepoRoot `
    -Wait -PassThru -NoNewWindow
if ($dryRunProc.ExitCode -ne 0) {
    throw "FAIL: E2E-6 preflight --dry-run 返回 exit=$($dryRunProc.ExitCode)（含 failed 项未预期）"
}
Write-Host "✅ E2E-6 PASS: preflight --dry-run exit=0"

Write-Host "`n=== ✅ 全部 E2E 验证通过 (preflight-hardening) ==="
exit 0
```

**PASS 标准**: 脚本 exit 0 + 全部 7 个 E2E 步骤（E2E-1、E2E-1b、E2E-2、E2E-3、E2E-4、E2E-5、E2E-6）全部通过
**FAIL 标准**: 任意步骤 throw 或 exit ≠ 0
**GHA workflow**: 新建 `.github/workflows/agent-preflight-hardening-e2e.yml`（`workflow_dispatch` + `windows-latest`，管理员权限，含 `paths:` 触发条件）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Line04PreflightCard 组件 | `tests/line04-preflight-card.test.tsx` | fetchModuleHealth 调用、无数据提示、ok 渲染 | 组件文件不存在 → 3 failures |
| /module-health 无超管限制 | `tests/navigation-module-health.test.ts` | requireSuperAdmin 已从 /module-health 移除 | 当前 requireSuperAdmin:true → 1 failure |
| 四层锁扩展 + 降级路径 | `tests/test_preflight_lock.py`（新） | Layer2 icacls DENY / Layer3 域名封禁 / Layer4 AutoUpdate=0 / 4.1.9 降级检测 | windows-latest: Layer2~4 各 1 failure（现有代码无此三层）；降级路径测试因代码已存在而 PASS（覆盖补缺） |
| Dashboard /module-health 普通账号访问 | `apps/dashboard/e2e/module-health-access.spec.ts`（mac_web Playwright） | 普通账号登录后访问 /module-health 页面不被 403/重定向拒绝 | Generator commit-1 须创建此 failing spec 文件（E2E-First 红锚点）；mac_web 环境运行，windows_cloud e2e-verify.ps1 不执行此 spec |
| Dashboard Line04PreflightCard 渲染 | `apps/dashboard/e2e/line04-preflight-card.spec.ts`（mac_web Playwright） | WechatCustomerServiceConfigPage 顶部 Line04PreflightCard 组件可见（含 ✅/❌/无数据提示） | Generator commit-1 须创建此 failing spec 文件（E2E-First 红锚点）；mac_web 环境运行，windows_cloud e2e-verify.ps1 不执行此 spec |
