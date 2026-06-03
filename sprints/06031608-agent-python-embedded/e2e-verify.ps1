# e2e-verify.ps1 — windows_cloud 静态验证（Agent Python embedded sprint v1.1.78）
# 在 GitHub Actions windows-latest runner 上执行，验证代码改动符合合同要求
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. build-install-pack.sh 含 python-embedded 下载步骤
Write-Host "`u{25B6} [1/5] 验证 build-install-pack.sh 含 python-embedded 步骤..."
$buildScript = Get-Content "$repoRoot\services\agent\scripts\build-install-pack.sh" -Raw
if ($buildScript -notmatch "python-embedded") {
  throw "FAIL: build-install-pack.sh 缺 python-embedded 下载步骤"
}
if ($buildScript -notmatch "embeddable") {
  throw "FAIL: build-install-pack.sh 缺 Python embeddable 字样"
}
Write-Host "OK build-install-pack.sh 含 python-embedded 步骤"

# 2. start.bat 含讲述人解锁命令
Write-Host "`u{25B6} [2/5] 验证 start.bat 含讲述人解锁命令..."
$startBat = Get-Content "$repoRoot\services\agent\install-pack\start.bat" -Raw
if ($startBat -notmatch "Start-Process Narrator") {
  throw "FAIL: start.bat 缺讲述人解锁命令 (Start-Process Narrator)"
}
if ($startBat -notmatch "Stop-Process") {
  throw "FAIL: start.bat 缺讲述人关闭命令 (Stop-Process)"
}
Write-Host "OK start.bat 含讲述人开关命令"

# 3. wechat-rpa.ts 含 python-embedded/python.exe 优先 + python3 回退
Write-Host "`u{25B6} [3/5] 验证 wechat-rpa.ts 含 python-embedded 优先 + python3 回退..."
$handlerContent = Get-Content "$repoRoot\services\agent\src\handlers\wechat-rpa.ts" -Raw
if ($handlerContent -notmatch "python-embedded") {
  throw "FAIL: wechat-rpa.ts 缺 python-embedded 路径优先逻辑"
}
if ($handlerContent -notmatch "python3") {
  throw "FAIL: wechat-rpa.ts 缺 python3 回退逻辑"
}
# 验证 startWechatListener 函数体也含 python-embedded
$fnIdx = $handlerContent.IndexOf("startWechatListener")
if ($fnIdx -ge 0) {
  $fnBody = $handlerContent.Substring($fnIdx, [Math]::Min(600, $handlerContent.Length - $fnIdx))
  if ($fnBody -notmatch "python-embedded") {
    throw "FAIL: startWechatListener 函数缺 python-embedded 优先逻辑"
  }
}
Write-Host "OK wechat-rpa.ts 含 python-embedded 优先 + python3 回退 + startWechatListener 覆盖"

# 4. smoke.sh 存在且含真实验证内容
Write-Host "`u{25B6} [4/5] 验证 agent-python-embedded-smoke.sh 存在且含真实内容..."
$smokePath = "$repoRoot\.github\workflows\scripts\smoke\agent-python-embedded-smoke.sh"
if (-not (Test-Path $smokePath)) {
  throw "FAIL: agent-python-embedded-smoke.sh 不存在"
}
$smokeContent = Get-Content $smokePath -Raw
$realLines = ($smokeContent -split "`n" | Where-Object { $_ -notmatch "^\s*#" -and $_.Trim() -ne "" }).Count
if ($realLines -le 5) {
  throw "FAIL: smoke.sh 仅 $realLines 行实质内容，疑似占位文件"
}
if ($smokeContent -notmatch "python-embedded") {
  throw "FAIL: smoke.sh 缺 python-embedded 验证断言"
}
Write-Host "OK agent-python-embedded-smoke.sh 存在（$realLines 行实质内容）"

# 5. 版本号 1.1.78
Write-Host "`u{25B6} [5/5] 验证 services/agent/package.json 版本号为 1.1.78..."
$pkgJson = Get-Content "$repoRoot\services\agent\package.json" -Raw | ConvertFrom-Json
if ($pkgJson.version -ne "1.1.78") {
  throw "FAIL: 版本号 '$($pkgJson.version)' 非 1.1.78"
}
Write-Host "OK 版本号 1.1.78 确认"

Write-Host ""
Write-Host "OK windows_cloud 静态验证全通 — Python embedded 安装包 sprint 合格"
exit 0
