# e2e-verify.ps1 — ZenithJoy Operator Dashboard E2E 验证脚本
# 目标：验证 /operator 页面（Session 健康状态矩阵）在 Windows runner 上正常渲染
# 执行环境：GitHub Actions windows-latest runner（通过 e2e-windows.yml 触发）

param(
    [string]$BaseUrl = "http://localhost:5174",
    [int]$Timeout = 30000
)

Write-Host "=== ZenithJoy Operator Dashboard E2E Verify ==="
Write-Host "Target: $BaseUrl/operator"
Write-Host "Timeout: ${Timeout}ms"

# 检查 Node.js 和 npx 是否可用
$nodeVersion = node --version 2>&1
Write-Host "Node.js: $nodeVersion"

# 安装 Playwright 依赖（如未安装）
if (-not (Test-Path "node_modules/@playwright/test")) {
    Write-Host "安装 Playwright..."
    npm install --save-dev @playwright/test 2>&1 | Write-Host
    npx playwright install chromium 2>&1 | Write-Host
}

# 运行 Playwright E2E 测试，指向 /operator 页面
Write-Host ""
Write-Host "--- 运行 Playwright E2E 测试 ---"

$testScript = @"
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 访问 /operator 页面
    const response = await page.goto('$BaseUrl/operator', { timeout: $Timeout, waitUntil: 'networkidle' });

    if (!response || response.status() >= 400) {
      console.error('FAIL: /operator 页面返回错误状态', response ? response.status() : 'no response');
      process.exit(1);
    }

    // 验证页面包含 8 平台状态矩阵关键元素
    const platforms = ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号'];
    const content = await page.textContent('body');

    const missing = platforms.filter(p => !content.includes(p));
    if (missing.length > 0) {
      console.error('FAIL: 页面缺失平台:', missing.join(', '));
      process.exit(1);
    }

    // 验证账号类型列
    const accountTypes = ['MAIN', 'SUB_1', 'SUB_2', 'SUB_3'];
    const missingTypes = accountTypes.filter(t => !content.includes(t));
    if (missingTypes.length > 0) {
      console.error('FAIL: 页面缺失账号类型:', missingTypes.join(', '));
      process.exit(1);
    }

    console.log('OK: /operator 页面验证通过，8 平台 × 4 账号矩阵正常渲染');

    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err.message);
    await browser.close();
    process.exit(1);
  }
})();
"@

# 写临时测试文件并通过 node 执行（Playwright API 模式）
$tmpFile = [System.IO.Path]::GetTempFileName() + ".js"
$testScript | Out-File -FilePath $tmpFile -Encoding utf8

try {
    node $tmpFile
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
    Write-Host "=== E2E FAILED ==="
    exit 1
}

Write-Host "=== E2E PASSED ==="
exit 0
