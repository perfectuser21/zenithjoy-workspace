# final-e2e 接缝验证脚本 — 微信客服 无审批自动回复闭环（xian-rog 真机）
# target_environment = windows_wechat（self-hosted runner，标签 wechat-capable，微信 4.1.8.107 已登录）
# 由 evaluator 派发：gh workflow run e2e-wechat-rpa.yml --repo perfectuser21/zenithjoy-workspace
#
# 接缝层（CI 绿 ≠ done，必须真机真送达）：
#   1) 开关上/下线播报真送达关键人
#   2) 名单内号自动回真送达 + 不抢焦点
#   3) 名单外号 pending_human 真可见（飞书/DB，created_at 在脚本启动后时间窗内）
#   4) 发送失败/掉线 → 告警真送达关键人
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0. 记录脚本启动时间（防造假：本轮 DB 记录/产物写入时间必须晚于此）
$ScriptStart = Get-Date

$agentDir   = "$env:LOCALAPPDATA\zenithjoy-agent"
$pythonExe  = "$agentDir\python-embedded\python.exe"
$rpaDir     = "$agentDir\wechat-rpa"
$listenChat = "$rpaDir\listen_chat.py"

# 1. 真实微信进程 + 真实版本（禁止 MOCK_WECHAT_VERSION 注入假环境）
if ($env:MOCK_WECHAT_VERSION) { throw "FAIL: 检测到 MOCK_WECHAT_VERSION 注入，接缝层禁止 mock" }
$wechatProc = Get-Process -Name WeChat,Weixin -ErrorAction SilentlyContinue
if (-not $wechatProc) { throw "FAIL: 微信未运行，xian-rog 预置条件未满足" }
$ver = & $pythonExe $listenChat --dryrun-print-version
if ($LASTEXITCODE -ne 0) { throw "FAIL: dryrun-print-version exit=$LASTEXITCODE" }
Write-Host "listen_chat version: $ver"

# 2. 接缝①：打开自动代理 → 关键人真收到上线播报
$onOut = & $pythonExe "$rpaDir\auto_reply_e2e.py" --toggle on
if ($LASTEXITCODE -ne 0) { throw "FAIL: 上线播报 exit=$LASTEXITCODE out=$onOut" }
$onOut | ConvertFrom-Json | ForEach-Object {
  if (-not $_.broadcast_delivered) { throw "FAIL: 上线播报未真送达关键人" }
}

# 3. 接缝②：名单内号发消息 → AI 1~5s 内自动回、真收到、不抢焦点
$inOut = & $pythonExe "$rpaDir\auto_reply_e2e.py" --whitelist-message
if ($LASTEXITCODE -ne 0) { throw "FAIL: 名单内自动回 exit=$LASTEXITCODE out=$inOut" }
$inOut | ConvertFrom-Json | ForEach-Object {
  if (-not $_.delivered)        { throw "FAIL: 名单内回复未真送达" }
  if ($_.focus_stolen)          { throw "FAIL: 发送抢了前台焦点（违反 B 方案）" }
  if ($_.reply_delay_s -lt 1.0 -or $_.reply_delay_s -gt 5.0) { throw "FAIL: 延迟 $($_.reply_delay_s)s 越界 [1,5]" }
}

# 4. 接缝③：名单外号发消息 → 不被自动回，飞书/DB 出现 pending_human（时间窗）
$outOut = & $pythonExe "$rpaDir\auto_reply_e2e.py" --stranger-message
if ($LASTEXITCODE -ne 0) { throw "FAIL: 名单外 exit=$LASTEXITCODE out=$outOut" }
$outOut | ConvertFrom-Json | ForEach-Object {
  if ($_.auto_replied)               { throw "FAIL: 名单外被自动回（应转人工）" }
  if (-not $_.pending_human_recorded){ throw "FAIL: 名单外未记 pending_human" }
  $w = [DateTime]$_.recorded_at
  if ($w -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: pending_human 记录时间 $w 早于脚本启动，疑似历史冒充" }
}

# 5. 接缝④：制造读回失败/掉线 → 告警真送达关键人
$alertOut = & $pythonExe "$rpaDir\auto_reply_e2e.py" --simulate-send-failure
if ($LASTEXITCODE -ne 0) { throw "FAIL: 告警 exit=$LASTEXITCODE out=$alertOut" }
$alertOut | ConvertFrom-Json | ForEach-Object {
  if (-not $_.alert_delivered) { throw "FAIL: 失败告警未真送达关键人" }
  if ($_.resent)               { throw "FAIL: 失败后重发了（应不重发防刷屏）" }
}

# 6. 关闭自动代理 → 关键人真收到下线播报
$offOut = & $pythonExe "$rpaDir\auto_reply_e2e.py" --toggle off
if ($LASTEXITCODE -ne 0) { throw "FAIL: 下线播报 exit=$LASTEXITCODE out=$offOut" }
$offOut | ConvertFrom-Json | ForEach-Object {
  if (-not $_.broadcast_delivered) { throw "FAIL: 下线播报未真送达关键人" }
}

Write-Host "✅ windows_wechat 接缝 E2E 全部真送达验证通过"
exit 0
