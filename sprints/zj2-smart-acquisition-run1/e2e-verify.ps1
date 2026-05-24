# final-e2e PowerShell 脚本（在 GitHub Actions windows-latest runner 上执行）
# 用途：ZenithJoy Dashboard + API 全链路 E2E 验收
param(
  [string]$ApiBase = "http://localhost:3001",
  [string]$DashboardBase = "http://localhost:5173",
  [string]$TestToken = $env:TEST_TOKEN
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 健康检查
$health = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/overview" -Method GET -TimeoutSec 10
if ($health.enabled -ne $true) { throw "FAIL: API 不健康 enabled=$($health.enabled)" }
Write-Host "✅ API 健康"

# 2. POST keyword-search → 验证 schema（含 Authorization header）
$body = '{"keyword":"装修"}'
$headers = @{ "Authorization" = "Bearer $TestToken"; "Content-Type" = "application/json" }
$kwResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/keyword-search" `
  -Method POST -Body $body -Headers $headers -TimeoutSec 10
if (-not $kwResp.task_id) { throw "FAIL: task_id 缺失" }
if ($kwResp.keywords.Count -ne 5) { throw "FAIL: keywords 长度非5，实际=$($kwResp.keywords.Count)" }
$keys = ($kwResp | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($keys -ne "keywords,task_id") { throw "FAIL: schema keys 不匹配，实际=$keys" }
Write-Host "✅ POST keyword-search schema 正确"

$taskId = $kwResp.task_id

# 3. POST video-search-result（Agent 调用，无用户 token）
$videoBody = "{`"keyword_task_id`":`"$taskId`",`"keyword`":`"装修`",`"videos`":[{`"video_url`":`"https://www.douyin.com/video/e2e001`"}]}"
$vidResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/video-search-result" `
  -Method POST -Body $videoBody -ContentType "application/json" -TimeoutSec 10
if ($vidResp.received -ne $true) { throw "FAIL: video-search-result received 非 true" }
Write-Host "✅ POST video-search-result 收到"

# 4. POST comment-score-result（Agent 调用，无用户 token）
$commentBody = "{`"keyword_task_id`":`"$taskId`",`"video_url`":`"https://www.douyin.com/video/e2e001`",`"comments`":[{`"commenter_id`":`"@e2e_user`",`"text`":`"怎么联系你`",`"publish_time`":`"2026-05-24T10:00:00Z`"}]}"
$cmtResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/comment-score-result" `
  -Method POST -Body $commentBody -ContentType "application/json" -TimeoutSec 30
if ($cmtResp.received -ne $true) { throw "FAIL: comment-score-result received 非 true" }
Write-Host "✅ POST comment-score-result 处理完成"

# 5. GET /api/acquisition/leads → schema 验证（含 Authorization header）
$leads = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads" -Method GET -Headers $headers -TimeoutSec 10
$topKeys = ($leads | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($topKeys -ne "leads,total") { throw "FAIL: leads schema keys 不匹配，实际=$topKeys" }

# lead item 6 字段完整性
if ($leads.leads.Count -gt 0) {
  $lead = $leads.leads[0]
  foreach ($f in @("commenter_id","comment_text","source_video_url","crawled_at","grade","keyword")) {
    if (-not ($lead | Get-Member -MemberType NoteProperty -Name $f)) {
      throw "FAIL: lead item 缺字段 $f"
    }
  }
  $validGrades = @("感兴趣","精准","高意向")
  if ($lead.grade -notin $validGrades) { throw "FAIL: grade 非法值=$($lead.grade)" }
  Write-Host "✅ lead item 6 字段完整"
}
Write-Host "✅ GET /api/acquisition/leads schema 正确"

# 6. grade 筛选
$filtered = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads?grade=高意向" -Method GET -Headers $headers -TimeoutSec 10
foreach ($lead in $filtered.leads) {
  if ($lead.grade -ne "高意向") { throw "FAIL: grade 筛选不正确，含 grade=$($lead.grade)" }
}
Write-Host "✅ grade 筛选正确"

# 7. grade 非法值 → 400
try {
  Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads?grade=invalid" -Method GET -Headers $headers -TimeoutSec 10
  throw "FAIL: 非法 grade 未返回 4xx"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw "FAIL: 非法 grade 返回了 $($_.Exception.Response.StatusCode.value__)，期望 400" }
  Write-Host "✅ 非法 grade → 400"
}

# 8. Playwright — /dashboard/leads 页面 UI 验证（tests/ws4/leads.test.ts）
$playwrightScript = @"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('$DashboardBase/dashboard/leads');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  const table = page.locator('[data-testid="leads-table"]');
  const visible = await table.isVisible({ timeout: 10000 });
  if (!visible) { console.error('FAIL: leads-table 不可见'); process.exit(1); }
  await page.screenshot({ path: 'screenshots/02-action.png' });
  await browser.close();
  console.log('✅ /dashboard/leads UI 验证通过');
})();
"@
$playwrightScript | node - 2>&1 | Write-Host

Write-Host ""
Write-Host "✅ windows_cloud E2E Golden Path 全部通过"
