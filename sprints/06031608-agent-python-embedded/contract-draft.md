# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 本 sprint 为打包脚本 + 文件改动，无新增 HTTP 端点。Reviewer 第 6 维自动满分。

---

## Golden Path

[客户下载安装包 v1.1.78] → [解压 → 双击 start.bat] → [讲述人解锁] → [python-embedded Python 启动 listen_chat.py] → [微信监听自动开始]

---

### Step 1: build-install-pack.sh 新增 Python 3.11 embeddable 下载与打包

**来源**: `[FROM_PRD]` — PRD「范围限定」第 1 条：`build-install-pack.sh` 加入 Python 3.11 embeddable 下载 + pip 安装 pywinauto/pywin32/requests + 拷贝 `wechat-rpa/*.py`

**可观测行为**: 执行 `build-install-pack.sh --dry-run --out $PACK_DIR` 后，`$PACK_DIR/python-embedded/python.exe` 存在；`$PACK_DIR/wechat-rpa/listen_chat.py` 和 `send_chat.py` 存在

**验证命令**:
```bash
PACK_DIR=$(mktemp -d)
bash services/agent/scripts/build-install-pack.sh --dry-run --out "$PACK_DIR"
[ -f "$PACK_DIR/python-embedded/python.exe" ] || { echo "FAIL: python-embedded/python.exe 缺失"; exit 1; }
[ -f "$PACK_DIR/wechat-rpa/listen_chat.py" ] || { echo "FAIL: listen_chat.py 缺失"; exit 1; }
[ -f "$PACK_DIR/wechat-rpa/send_chat.py" ] || { echo "FAIL: send_chat.py 缺失"; exit 1; }
echo OK
```

**硬阈值**: 三个文件均存在，exit 0

---

### Step 2: start.bat 加入讲述人解锁 PowerShell 命令

**来源**: `[FROM_PRD]` — PRD「范围限定」第 2 条：`install-pack/start.bat` 加入讲述人解锁 PowerShell 一句命令

**可观测行为**: `start.bat` 文件中含 `Start-Process Narrator` 调用与 `Stop-Process -Name Narrator` 收尾，覆盖讲述人开关逻辑

**验证命令**:
```bash
grep -q "Start-Process Narrator" services/agent/install-pack/start.bat || { echo "FAIL: start.bat 缺 Start-Process Narrator"; exit 1; }
grep -q "Stop-Process" services/agent/install-pack/start.bat || { echo "FAIL: start.bat 缺 Stop-Process 收尾"; exit 1; }
echo OK
```

**硬阈值**: 两条 grep 均找到，exit 0

---

### Step 3: wechat-rpa.ts handler 优先使用 python-embedded/python.exe

**来源**: `[FROM_PRD]` — PRD「范围限定」第 3 条：`src/handlers/wechat-rpa.ts` handler 改用 `python-embedded/python.exe` 优先逻辑

**可观测行为**: handler 在 spawn 前检测 `./python-embedded/python.exe` 是否存在，存在时用内置 Python，否则回退 `python3`；`startWechatListener` 函数同样使用此逻辑

**验证命令**:
```bash
grep -q "python-embedded" services/agent/src/handlers/wechat-rpa.ts || { echo "FAIL: wechat-rpa.ts 缺 python-embedded 路径"; exit 1; }
grep -q "existsSync\|existSync\|fs\." services/agent/src/handlers/wechat-rpa.ts || { echo "FAIL: wechat-rpa.ts 缺文件存在检测"; exit 1; }
echo OK
```

**硬阈值**: handler 文件含路径检测与 python-embedded 引用，exit 0

---

### Step 4: agent-python-embedded-smoke.sh 新建且含真实内容验证

**来源**: `[FROM_PRD]` — PRD「预期受影响文件」第 4 条：`.github/workflows/scripts/smoke/agent-python-embedded-smoke.sh`（新建），CI 静态验证安装包内容

**可观测行为**: smoke 脚本存在，含 `--dry-run` 调用 + 至少 3 个文件存在性断言（python-embedded/python.exe、listen_chat.py、send_chat.py），不是 `exit 0` 占位

**验证命令**:
```bash
SMOKE=".github/workflows/scripts/smoke/agent-python-embedded-smoke.sh"
[ -f "$SMOKE" ] || { echo "FAIL: smoke.sh 不存在"; exit 1; }
REAL_LINES=$(grep -v '^#' "$SMOKE" | grep -v '^[[:space:]]*$' | wc -l | tr -d ' ')
[ "$REAL_LINES" -gt 5 ] || { echo "FAIL: smoke.sh 仅 $REAL_LINES 行实质内容，疑似占位"; exit 1; }
grep -q "python-embedded" "$SMOKE" || { echo "FAIL: smoke.sh 缺 python-embedded 断言"; exit 1; }
echo OK
```

**硬阈值**: 文件存在，≥ 6 行非注释内容，含 python-embedded 断言，exit 0

---

### Step 5: 版本号 bump 至 1.1.78

**来源**: `[FROM_PRD]` — PRD「范围限定」最后一条：版本号打包为 v1.1.78

**可观测行为**: `services/agent/package.json` 的 `version` 字段为 `1.1.78`

**验证命令**:
```bash
VER=$(node -e "console.log(require('./services/agent/package.json').version)")
[ "$VER" = "1.1.78" ] || { echo "FAIL: 版本号 $VER 非 1.1.78"; exit 1; }
echo OK
```

**硬阈值**: version = "1.1.78"，exit 0

---

### Step 6: python-embedded 回退逻辑（边界场景）

**来源**: `[FROM_PRD]` — PRD「边界情况」第 2 条：`python-embedded/python.exe` 不存在时 handler 回退到系统 `python3`

**可观测行为**: `wechat-rpa.ts` 在检测 python-embedded 不存在时使用 `python3`，不抛出异常，控制台无「FATAL」输出

**验证命令**:
```bash
# 静态分析：handler 含 fallback 逻辑（三元或 if/else 含 'python3'）
node -e "
const c = require('fs').readFileSync('services/agent/src/handlers/wechat-rpa.ts', 'utf8');
if (!c.includes('python-embedded')) process.exit(1);
if (!c.includes(\"'python3'\") && !c.includes('\"python3\"')) process.exit(2);
console.log('OK: 含 python-embedded 优先 + python3 回退');
" || { echo "FAIL: wechat-rpa.ts 缺回退到 python3 的逻辑"; exit 1; }
```

**硬阈值**: handler 文件同时含 python-embedded 路径和 python3 字符串，exit 0

---

## E2E 验收（最终 final-e2e 跑 — windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud

> windows_cloud 用户路径映射（已读取 `.github/workflows/e2e-windows.yml`）：
> 1. GHA 在干净 windows-latest runner 上 checkout 代码
> 2. 执行 `$sprint_dir/e2e-verify.ps1`
> 3. PS1 对代码做静态分析（本 sprint 为打包脚本静态验证，非安装运行验证）
> 工作流覆盖完整 — 无 [CI_GAP]

```powershell
# e2e-verify.ps1 — windows_cloud 静态验证（安装包 Python embedded sprint）
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. build-install-pack.sh 含 python-embedded 下载步骤
Write-Host "▶ [1/5] 验证 build-install-pack.sh 含 python-embedded 步骤..."
$buildScript = Get-Content "$repoRoot\services\agent\scripts\build-install-pack.sh" -Raw
if ($buildScript -notmatch "python-embedded") {
  throw "FAIL: build-install-pack.sh 缺 python-embedded 下载步骤"
}
if ($buildScript -notmatch "embeddable") {
  throw "FAIL: build-install-pack.sh 缺 Python embeddable 字样"
}
Write-Host "✅ build-install-pack.sh 含 python-embedded 步骤"

# 2. start.bat 含讲述人解锁命令
Write-Host "▶ [2/5] 验证 start.bat 含讲述人解锁命令..."
$startBat = Get-Content "$repoRoot\services\agent\install-pack\start.bat" -Raw
if ($startBat -notmatch "Start-Process Narrator") {
  throw "FAIL: start.bat 缺讲述人解锁命令 (Start-Process Narrator)"
}
if ($startBat -notmatch "Stop-Process") {
  throw "FAIL: start.bat 缺讲述人关闭命令 (Stop-Process)"
}
Write-Host "✅ start.bat 含讲述人开关命令"

# 3. wechat-rpa.ts 含 python-embedded/python.exe 路径优先逻辑 + python3 回退
Write-Host "▶ [3/5] 验证 wechat-rpa.ts 含 python-embedded 优先 + python3 回退..."
$handlerContent = Get-Content "$repoRoot\services\agent\src\handlers\wechat-rpa.ts" -Raw
if ($handlerContent -notmatch "python-embedded") {
  throw "FAIL: wechat-rpa.ts 缺 python-embedded 路径优先逻辑"
}
if ($handlerContent -notmatch "python3") {
  throw "FAIL: wechat-rpa.ts 缺 python3 回退逻辑"
}
Write-Host "✅ wechat-rpa.ts 含 python-embedded 优先 + python3 回退"

# 4. smoke.sh 存在且含真实验证内容
Write-Host "▶ [4/5] 验证 agent-python-embedded-smoke.sh 存在且含真实内容..."
$smokePath = "$repoRoot\.github\workflows\scripts\smoke\agent-python-embedded-smoke.sh"
if (-not (Test-Path $smokePath)) {
  throw "FAIL: agent-python-embedded-smoke.sh 不存在"
}
$smokeContent = Get-Content $smokePath -Raw
$realLines = ($smokeContent -split "`n" | Where-Object { $_ -notmatch "^[[:space:]]*#" -and $_.Trim() -ne "" }).Count
if ($realLines -le 5) {
  throw "FAIL: smoke.sh 仅 $realLines 行实质内容，疑似占位文件"
}
if ($smokeContent -notmatch "python-embedded") {
  throw "FAIL: smoke.sh 缺 python-embedded 验证断言"
}
Write-Host "✅ agent-python-embedded-smoke.sh 存在且含真实验证内容"

# 5. 版本号 1.1.78
Write-Host "▶ [5/5] 验证 services/agent/package.json 版本号为 1.1.78..."
$pkgJson = Get-Content "$repoRoot\services\agent\package.json" -Raw | ConvertFrom-Json
if ($pkgJson.version -ne "1.1.78") {
  throw "FAIL: 版本号 '$($pkgJson.version)' 非 1.1.78"
}
Write-Host "✅ 版本号 1.1.78 确认"

Write-Host ""
Write-Host "✅ windows_cloud 静态验证全通 — Python embedded 安装包 sprint 合格"
exit 0
```

**PASS 标准**: 脚本 exit 0，5 项检查全通
**FAIL 标准**: 任何 `throw` 触发 OR exit ≠ 0
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

---

## Risks

来源：PRD `[ASSUMPTION]` 段明确标注的已知技术陷阱，Generator 在实现时必须逐一处理。

| # | 风险 | 触发条件 | Mitigation（Generator 必做） |
|---|---|---|---|
| R1 | **python311._pth 未启用 site-packages** → pip install 成功但 `import pywinauto` 失败 | Python 3.11 embeddable 默认 `python311._pth` 注释掉 `import site`，导致 pip 装的包对解释器不可见 | `build-install-pack.sh` 在 `python3 -m pip install` 之前，必须显式 patch `python311._pth`：追加一行 `import site` 或取消注释该行 |
| R2 | **pywinauto/pywin32 路径 isolation 问题** → pip 把包装到全局 `site-packages` 而非 embeddable 内部 | pip install 未指定 `--target`，包落到系统目录而非 `python-embedded/Lib/site-packages` | `pip install --target ./python-embedded/Lib/site-packages pywinauto pywin32 requests`；安装后运行 `python-embedded/python.exe -c "import pywinauto; print('ok')"` 验证 import 成功，失败则 build exit 1 |
| R3 | **Python embeddable 下载 URL 不稳定** → CI 失败或下载到错误文件 | `python.org` CDN 偶尔改路径；网络超时 | 在 `build-install-pack.sh` 中 hardcode SHA256 哈希值并在下载后 `shasum -a 256 --check` 校验；失败 exit 1（阻止构建含损坏 Python 的包） |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `sprints/06031608-agent-python-embedded/tests/agent-python-embedded.test.ts` | build脚本含python-embedded / start.bat含Narrator / handler含python-embedded路径+python3回退 / startWechatListener函数含python-embedded / smoke.sh存在且含内容 / package.json版本1.1.78 / e2e-verify.ps1存在 | → 6 failures（test-7 e2e-verify.ps1 proposer 已写入，预期 PASS） |
