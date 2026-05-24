# Sprint Contract Draft (Round 1) — zj-douyin-article-agent-port

**Sprint**：publish-douyin-article CDP 移植 + install pack 打包
**journey_type**：autonomous
**target_environment**：windows_cloud
**PRD**：`sprints/zj-douyin-article-agent-port/sprint-prd.md`

---

## Golden Path

[中台下发 article 任务] → [Agent 路由到 article 脚本] → [CDP 连 Chrome :19222] → [填标题/正文/封面（DOM.setFileInputFiles）] → [dryrun 停在发布前] → [回执 {ok:true,dryRun:true}] → [install pack 含所有 .cjs]

---

### Step 1: 中台下发 article 任务，`resolveDouyinScriptPath({type:'article'})` 成功路由

**来源**: `[FROM_PRD]` — PRD Golden Path Step 2："`resolveDouyinScriptPath({type:'article'})` 路由到 article 脚本（不抛'暂未实现'）"

**可观测行为**: 调用 resolveDouyinScriptPath 传 type='article' 返回有效脚本路径，不抛 Error，不走 SUPPORTED_DOUYIN_TYPES 的"暂未实现"分支

**验证命令**:
```bash
cd /workspace/services/agent
# 用 ts-node 或 vitest 跑路由检查
node -e "
  process.env.ZENITHJOY_AGENT_REAL_PUBLISH='0';
  // 确认 article 在 SUPPORTED 集合中
  const src = require('fs').readFileSync('src/handlers/douyin-publish.ts','utf8');
  if(!src.includes(\"'article'\")) { console.error('FAIL: article not in SUPPORTED_DOUYIN_TYPES'); process.exit(1); }
  console.log('OK: article 路由存在');
"
```

**硬阈值**: exit 0，输出含 'OK'

---

### Step 2: `publish-douyin-article.cjs` 存在，封面用 `DOM.setFileInputFiles(backendNodeId)` 上传

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3："脚本 CDP 连浏览器，封面用 `DOM.setFileInputFiles(backendNodeId)` 上传本地路径"

**可观测行为**: 脚本文件存在，包含 CDP `DOM.setFileInputFiles` 调用（不用 Playwright setInputFiles 或旧 SCP 路径）

**验证命令**:
```bash
SCRIPT=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs
[ -f "$SCRIPT" ] || { echo "FAIL: 脚本不存在"; exit 1; }
grep -q "DOM.setFileInputFiles" "$SCRIPT" || { echo "FAIL: 未用 DOM.setFileInputFiles"; exit 1; }
grep -q "backendNodeId" "$SCRIPT" || { echo "FAIL: backendNodeId 未出现"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，输出含 'OK'

---

### Step 3: 发布按钮通过 XPath 定位，代码中无 `button:has-text`

**来源**: `[FROM_PRD]` — PRD Golden Path Step 4："发布按钮用 XPath（禁用 `button:has-text`）"

**可观测行为**: 脚本用 XPath 选发布按钮，`button:has-text` 字符串在两个脚本中均不出现

**验证命令**:
```bash
PUBLISHER_DIR=/workspace/services/agent/publishers/douyin-publisher
! grep -q "button:has-text" "$PUBLISHER_DIR/publish-douyin-article.cjs" || { echo "FAIL: article 含 button:has-text"; exit 1; }
! grep -q "button:has-text" "$PUBLISHER_DIR/publish-douyin-article-dryrun.cjs" || { echo "FAIL: dryrun 含 button:has-text"; exit 1; }
grep -q "xpath\|XPath\|//\*\|//" "$PUBLISHER_DIR/publish-douyin-article.cjs" || { echo "FAIL: 未找到 XPath 选择器"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，输出含 'OK'

---

### Step 4: dryrun 脚本填完所有字段后停止，输出 `{ok:true,dryRun:true}`，不触发发布

**来源**: `[FROM_PRD]` — PRD Golden Path Step 5："dryrun：填完停止不点发布；real：点发布并回执"

**可观测行为**: dryrun 脚本存在，代码中有 `dryRun: true` 输出路径，无直接调用发布 API 的代码

**验证命令**:
```bash
DRYRUN=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs
[ -f "$DRYRUN" ] || { echo "FAIL: dryrun 脚本不存在"; exit 1; }
grep -q '"dryRun":.*true\|dryRun: true' "$DRYRUN" || { echo "FAIL: dryrun 输出中无 dryRun:true"; exit 1; }
# dryrun 不含 create_v2 API 调用（真发专用路径）
! grep -q "create_v2\|aweme/create" "$DRYRUN" || { echo "FAIL: dryrun 不允许调用发布 API"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，输出含 'OK'

---

### Step 5: `build-install-pack.sh` 包含 `publishers/douyin-publisher/` 复制逻辑

**来源**: `[FROM_PRD]` — PRD 边界情况："install pack 解压后 `publishers/douyin-publisher/` 必须含所有 `.cjs`"；PRD 范围限定："install pack 加 publishers/"

**可观测行为**: 构建脚本包含将 publishers/ 目录复制到 pack 目录的命令

**验证命令**:
```bash
SCRIPT=/workspace/services/agent/scripts/build-install-pack.sh
grep -q "publishers" "$SCRIPT" || { echo "FAIL: build-install-pack.sh 无 publishers 复制逻辑"; exit 1; }
grep -q "douyin-publisher\|publishers/\*\|publishers/" "$SCRIPT" || { echo "FAIL: publishers/douyin-publisher 未覆盖"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，输出含 'OK'

---

### Step 6: `package.json` version 已从 1.1.25 bump 至 1.1.26

**来源**: `[FROM_PRD]` — PRD 范围限定："版本 bump 1.1.25→1.1.26"

**可观测行为**: `services/agent/package.json` 中 version 字段为 "1.1.26"

**验证命令**:
```bash
VER=$(node -e "console.log(require('/workspace/services/agent/package.json').version)")
[ "$VER" = "1.1.26" ] || { echo "FAIL: version=$VER 期望 1.1.26"; exit 1; }
echo "OK: version=$VER"
```

**硬阈值**: version 字段字面值 == "1.1.26"，exit 0

---

### Step 7: cover 路径不存在时脚本 fail fast，输出 `{ok:false,error}`

**来源**: `[AI_ADDED]` — PRD 边界情况明确"cover 文件必须存在；不传则 fail fast"，但 Golden Path 未列为独立步骤。Generator 容易仅做 `typeof cover === 'string'` 检查而遗漏 `fs.existsSync` — 此步 pin 住文件存在性校验点，防止客户机因封面路径失效导致 CDP 挂起

**可观测行为**: 传入不存在的 cover 路径时，脚本快速退出（exit 1），stdout 最后一行为 `{ok:false,error:"..."}`

**验证命令**:
```bash
SCRIPT=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs
grep -q "existsSync\|ENOENT\|cover.*not found\|cover.*exist" "$SCRIPT" || \
  { echo "FAIL: article 脚本无 cover 存在性检查"; exit 1; }
grep -q "existsSync\|ENOENT\|cover.*not found\|cover.*exist" \
  /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs || \
  { echo "FAIL: dryrun 脚本无 cover 存在性检查"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，两个脚本均含 fail fast 逻辑

---

### Step 8: summary 缺省取 `content.substring(0, 30)`

**来源**: `[AI_ADDED]` — PRD 边界情况："`summary` 可选，缺省取 `content.substring(0, 30)`"，但无独立 Golden Path 步骤。Generator 可能写 `summary = summary || ''` 绕过 — 此步确保 substring 截取逻辑存在于实现中，防止长文无摘要被抖音后台拒绝

**可观测行为**: 脚本包含 `content.substring(0, 30)` 或等效的 30 字截取逻辑

**验证命令**:
```bash
SCRIPT=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs
grep -qE "content\.substring\(0,\s*30\)|content\.slice\(0,\s*30\)" "$SCRIPT" || \
  { echo "FAIL: 无 summary 缺省截取逻辑"; exit 1; }
echo "OK"
```

**硬阈值**: exit 0，包含 substring(0, 30) 或 slice(0, 30)

---

## 注册表防冲突检查

**本 sprint 无新 HTTP 端点**（Response Schema: N/A）— 无 API 命名冲突风险
**本 sprint 无新 DB 表/字段** — 无 schema 冲突风险

---

## E2E 验收（final-e2e — target_environment = windows_cloud）

**journey_type**: autonomous
**target_environment**: windows_cloud（GitHub Actions windows-latest，干净 VM，模拟客户安装验收）

```powershell
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

Write-Host ""
Write-Host "✅ Golden Path 全部 8 步验证通过 — publish-douyin-article CDP 移植完成"
```

**通过标准**: PowerShell 脚本 exit 0，全部 8 个 ✅ 输出可见

---

## Workstreams

**workstream_count**: 4

### Workstream 1: CDP article 发布脚本（publish-douyin-article.cjs + dryrun）

**范围**: 新建两个 CJS 脚本，实现 CDP 直连 Chrome :19222，填标题/正文/封面（`DOM.setFileInputFiles`），发布按钮走 XPath，dryrun 停在发布前
**大小**: M（两文件合计约 180 行净增）
**依赖**: 无
**文件**:
- `services/agent/publishers/douyin-publisher/publish-douyin-article.cjs`（新建 ~100 行）
- `services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs`（新建 ~80 行）

### Workstream 2: article 路由（douyin-publish.ts）

**范围**: 将 'article' 加入 `SUPPORTED_DOUYIN_TYPES`，`resolveDouyinScriptPath` 按 type='article' 路由到 ws1 脚本
**大小**: S（约 15 行净改）
**依赖**: Workstream 1 完成后（脚本文件须先存在，resolveScriptPath 验证 fs.existsSync）
**文件**:
- `services/agent/src/handlers/douyin-publish.ts`

### Workstream 3: install pack + 版本号

**范围**: `build-install-pack.sh` 加入 `cp -r publishers/ $PACK_DIR/publishers/` 逻辑；`package.json` version 1.1.25 → 1.1.26
**大小**: S（约 10 行净改，2 文件）
**依赖**: Workstream 2 完成后
**文件**:
- `services/agent/scripts/build-install-pack.sh`
- `services/agent/package.json`

### Workstream 4: 测试套件（publish-douyin-article.test.cjs）

**范围**: 为 ws1 的 CJS 脚本写 vitest 单元测试，覆盖 fail fast / dryRun:true / summary 截取 3 个 BEHAVIOR
**大小**: S（约 80 行净增，1 文件）
**依赖**: Workstream 1 完成后
**文件**:
- `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs`

---

## Workstreams 切分自查（v7.7 B14）

| WS | 文件数 | 预计净增行数 | 是否合规 |
|---|---|---|---|
| ws1 | 2 | ~180 | ✅ ≤200 行，≤3 文件 |
| ws2 | 1 | ~15  | ✅ S |
| ws3 | 2 | ~10  | ✅ S |
| ws4 | 1 | ~80  | ✅ S |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` | 脚本可 require / dryRun:true 输出 / cover fail fast / summary 截取 | 文件不存在 → 4 failures |
| WS2 | `tests/ws2/routing.test.ts` | article 路由不抛 / 未实现类型仍抛 | article 不在 SUPPORTED → 1 failure |
| WS3 | `tests/ws3/install-pack.test.ts` | version=1.1.26 / publishers 复制命令存在 | version 仍 1.1.25 → 1 failure |
| WS4 | `publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` | 同 WS1（ws4 产出即 ws1 测试文件） | — |

---

## GAN 来源标注汇总

| 类型 | Steps |
|---|---|
| FROM_PRD | Step 1（PRD GP Step 2），Step 2（PRD GP Step 3），Step 3（PRD GP Step 4），Step 4（PRD GP Step 5），Step 5（PRD 边界情况），Step 6（PRD 范围限定） |
| AI_ADDED | Step 7（cover fail fast — pin 文件存在性校验，防 CDP 挂起），Step 8（summary substring(0,30) — 防空摘要被抖音拒绝） |
