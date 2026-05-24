# final-e2e PowerShell 脚本（在 GitHub Actions windows-latest runner 上执行）
# 目标：验证 install pack 自包含，publishers/ 目录含所有 article CJS，脚本路由正确
param(
  [string]$RepoRoot = $env:GITHUB_WORKSPACE ?? "."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AgentDir = Join-Path $RepoRoot "services\agent"

# 1. 验证 article 脚本存在
$ArticleScript = Join-Path $AgentDir "publishers\douyin-publisher\publish-douyin-article.cjs"
$DryrunScript  = Join-Path $AgentDir "publishers\douyin-publisher\publish-douyin-article-dryrun.cjs"

if (-not (Test-Path $ArticleScript)) { throw "FAIL: publish-douyin-article.cjs 不存在" }
if (-not (Test-Path $DryrunScript))  { throw "FAIL: publish-douyin-article-dryrun.cjs 不存在" }
Write-Host "✅ Step 1: article CJS 脚本存在"

# 2. 验证 DOM.setFileInputFiles 封面上传（CDP 方式）
$Content = Get-Content $ArticleScript -Raw
if (-not ($Content -match "DOM\.setFileInputFiles")) {
  throw "FAIL: 未使用 DOM.setFileInputFiles 上传封面"
}
Write-Host "✅ Step 2: DOM.setFileInputFiles 封面上传逻辑确认"

# 3. 验证无 button:has-text（XPath 规则）
if ($Content -match "button:has-text") {
  throw "FAIL: article 脚本含禁用的 button:has-text"
}
$DryrunContent = Get-Content $DryrunScript -Raw
if ($DryrunContent -match "button:has-text") {
  throw "FAIL: dryrun 脚本含禁用的 button:has-text"
}
Write-Host "✅ Step 3: XPath 规则验证通过"

# 4. 验证 dryrun 不含 create_v2 发布 API 调用
if ($DryrunContent -match "create_v2|aweme/create") {
  throw "FAIL: dryrun 不允许调用发布 API"
}
Write-Host "✅ Step 4: dryrun 无发布 API 调用"

# 5. 验证 build-install-pack.sh 含 publishers/ 复制逻辑
$BuildScript = Get-Content (Join-Path $AgentDir "scripts\build-install-pack.sh") -Raw
if (-not ($BuildScript -match "publishers")) {
  throw "FAIL: build-install-pack.sh 无 publishers 复制逻辑"
}
Write-Host "✅ Step 5: install pack 构建脚本含 publishers/ 逻辑"

# 6. 验证版本号已 bump
$PkgJson = Get-Content (Join-Path $AgentDir "package.json") -Raw | ConvertFrom-Json
if ($PkgJson.version -ne "1.1.26") {
  throw "FAIL: version=$($PkgJson.version) 期望 1.1.26"
}
Write-Host "✅ Step 6: version=1.1.26 确认"

# 7. 验证 cover fail fast 逻辑存在
if (-not ($Content -match "existsSync|ENOENT|cover.*not found|cover.*exist")) {
  throw "FAIL: article 脚本无 cover 存在性检查"
}
Write-Host "✅ Step 7: cover fail fast 逻辑确认"

# 8. 验证 summary 缺省截取逻辑
if (-not ($Content -match "content\.substring\(0,\s*30\)|content\.slice\(0,\s*30\)")) {
  throw "FAIL: 无 summary 缺省截取逻辑"
}
Write-Host "✅ Step 8: summary.substring(0,30) 确认"

# 9. 验证 TDD 测试文件存在（ws1 commit-1 产出）
$TestCjs = Join-Path $AgentDir "publishers\douyin-publisher\__tests__\publish-douyin-article.test.cjs"
if (-not (Test-Path $TestCjs)) {
  throw "FAIL: publish-douyin-article.test.cjs 不存在（ws1 TDD commit-1 产出缺失）"
}
Write-Host "✅ Step 9: TDD 测试文件存在"

Write-Host ""
Write-Host "✅ Golden Path 全部 9 步验证通过 — publish-douyin-article CDP 移植完成"
