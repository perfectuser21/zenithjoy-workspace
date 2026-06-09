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
assert result['status'] == 'failed', f'FAIL: 4.1.9 dry_run 应返回 failed，实际 {result["status"]}'
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
assert result['status'] in ('ok', 'fixed'), f'FAIL: status={result["status"]}'
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
  if (lines[i].includes("path: '/module-health'")) { inMH = true; startLine = i; }
  if (inMH && i > startLine + 1 && lines[i].includes("path: '/")) inMH = false;
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
