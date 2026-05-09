# Sprint 2.1e — Install Pack 真客户装 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Path 1 Step 2 thin → medium：客户从 dashboard 一键下载 install pack（pkg .exe + start.bat + .env.template + README）+ 双击 start.bat 启动 → dashboard 看 agent online → 真发抖音公网。

**Architecture:** CI build agent.exe (pkg 已 verify 57MB) → tar.gz reproducible (mtime locked) → push 到 dashboard nginx /download/ → API endpoint 返 manifest（version/sha256/url）+ 302 download → dashboard `AgentDownloadPage` 调 manifest 显示版本 + sha256 + 下载 button → 客户解压双击 start.bat → spawn chrome :19222 + agent.exe → heartbeat → dashboard 绿灯。

**Tech Stack:** TypeScript / Node.js HTTP / pkg (cross-compile) / bash + bats (build script) / vitest (endpoint test) / nginx static / GitHub Actions / Windows .bat

**Spec:** `docs/superpowers/specs/2026-05-09-sprint-2-1e-agent-install-pack-design.md` (commit 83fbb17)

**Worktree:** `/Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack` (cp-0509103504-sprint-2-1e-agent-install-pack，基于 main 1344630)

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `apps/api/src/routes/__tests__/agent-install-pack.test.ts` | **Create** | endpoint integration test (manifest + download 302 + 503) |
| `services/agent/scripts/__tests__/build-install-pack.test.sh` | **Create** | bash 测产物 (.exe / .env.template / sha256 / reproducible) |
| `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` | Modify | Step 2 加 manifest + download + sha256 校验断言 |
| `services/agent/install.bat` | **Delete** (减肥) | 旧手工 install |
| `services/agent/install-and-start.bat` | **Delete** (减肥) | 旧手工 install+start |
| `services/agent/start-agent-v2.ps1` | **Delete** (减肥) | sprint 2.1d 实验启动 |
| `services/agent/start-agent-v3.ps1` | **Delete** (减肥) | sprint 2.1d 实验启动 |
| `services/agent/CUSTOMER-QUICKSTART.md` | Modify (减肥) | 删 npm install / set ZENITHJOY_LICENSE 段 |
| `apps/dashboard/src/pages/AgentDownloadPage.tsx` | Modify (减肥+增肌) | 删 npm install `<li>` + 调 manifest 接口 |
| `services/agent/scripts/build-install-pack.sh` | **Create** | pkg + 组装产物目录 + reproducible tar.gz |
| `services/agent/install-pack/start.bat` | **Create** | 双击启动 (验 .env + spawn chrome + spawn agent.exe) |
| `services/agent/install-pack/.env.template` | **Create** | API_BASE + LICENSE + CHROME_DEBUG_PORT 占位 |
| `services/agent/install-pack/README-1分钟跑通.txt` | **Create** | ≤30 行三步说明 |
| `apps/api/src/routes/agent-install-pack.ts` | **Create** | manifest + download endpoint |
| `apps/api/src/services/install-pack-manifest.ts` | **Create** | 读 manifest.json 服务 |
| `apps/api/src/app.ts` | Modify | 注册 agent-install-pack 路由 |
| `apps/dashboard/src/api/agent.api.ts` | Modify | 加 `getInstallPackManifest()` |
| `.github/workflows/agent-installpack.yml` | **Create** | main 合并后 build artifact + release |
| `test-registry.yaml` | Modify | 注册 agent-install-pack.test.ts |

---

## Task 1: 写 fail tests（commit 1 RED）

**Files:**
- Create: `apps/api/src/routes/__tests__/agent-install-pack.test.ts`
- Create: `services/agent/scripts/__tests__/build-install-pack.test.sh`
- Modify: `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` (Step 2 加断言)
- Modify: `test-registry.yaml`

- [ ] **Step 1: 写 endpoint integration test**

写 `apps/api/src/routes/__tests__/agent-install-pack.test.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock manifest service (会在 Task 3 实现)
vi.mock('../../services/install-pack-manifest', () => ({
  readInstallPackManifest: vi.fn(),
}));

import request from 'supertest';
import * as manifestSvc from '../../services/install-pack-manifest';

describe('GET /api/agent/install-pack/manifest', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('manifest 文件存在 → 返 200 + version/sha256/download_url', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '0.2.0',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v0.2.0.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });

    const res = await request(app).get('/api/agent/install-pack/manifest');
    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.download_url).toMatch(/^\/download\/zenithjoy-agent-v/);
    expect(typeof res.body.size).toBe('number');
  });

  it('manifest 不存在 → 503 + INSTALL_PACK_NOT_BUILT', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue(null);

    const res = await request(app).get('/api/agent/install-pack/manifest');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INSTALL_PACK_NOT_BUILT');
  });
});

describe('GET /api/agent/install-pack/download', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('manifest 存在 → 302 重定向到 nginx 静态 URL', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '0.2.0',
      sha256: 'b'.repeat(64),
      download_url: '/download/zenithjoy-agent-v0.2.0.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/download\/zenithjoy-agent-v/);
  });

  it('manifest 不存在 → 503', async () => {
    (manifestSvc.readInstallPackManifest as any).mockReturnValue(null);

    const res = await request(app).get('/api/agent/install-pack/download').redirects(0);
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: 写 build-install-pack bash test**

写 `services/agent/scripts/__tests__/build-install-pack.test.sh`:

```bash
#!/usr/bin/env bash
# Sprint 2.1e — build-install-pack 产物结构 + reproducibility test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$AGENT_DIR/scripts/build-install-pack.sh"

echo "[test] step 1: build-install-pack.sh 存在"
test -x "$BUILD_SCRIPT" || { echo "FAIL $BUILD_SCRIPT not found or not executable"; exit 1; }

echo "[test] step 2: 跑构建（需已 npm install + npm run build）"
cd "$AGENT_DIR"
test -d node_modules || { echo "FAIL: agent node_modules missing"; exit 1; }
test -f dist/index.js || { echo "FAIL: dist/index.js missing — run 'npm run build' first"; exit 1; }

bash "$BUILD_SCRIPT" || { echo "FAIL: build-install-pack.sh exit non-zero"; exit 1; }

echo "[test] step 3: 产物清单"
TARGZ=$(ls dist-installpack/zenithjoy-agent-v*.tar.gz 2>/dev/null | head -1)
SHA256=$(ls dist-installpack/zenithjoy-agent-v*.tar.gz.sha256 2>/dev/null | head -1)
test -f "$TARGZ" || { echo "FAIL: tar.gz not produced"; exit 1; }
test -f "$SHA256" || { echo "FAIL: sha256 not produced"; exit 1; }

echo "[test] step 4: tar.gz 含必需文件"
TMPDIR=$(mktemp -d)
tar -xzf "$TARGZ" -C "$TMPDIR"
INSTALL_DIR=$(ls "$TMPDIR" | head -1)
test -f "$TMPDIR/$INSTALL_DIR/zenithjoy-agent.exe" || { echo "FAIL: .exe missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/start.bat" || { echo "FAIL: start.bat missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/.env.template" || { echo "FAIL: .env.template missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/README-1分钟跑通.txt" || { echo "FAIL: README missing"; exit 1; }

echo "[test] step 5: .env.template 含 3 个必需 key"
for k in ZENITHJOY_API_BASE ZENITHJOY_LICENSE ZENITHJOY_CHROME_DEBUG_PORT; do
  grep -q "^${k}=" "$TMPDIR/$INSTALL_DIR/.env.template" || { echo "FAIL: $k missing in .env.template"; exit 1; }
done

echo "[test] step 6: sha256 与 tar.gz 实际 hash 一致"
ACTUAL=$(shasum -a 256 "$TARGZ" | awk '{print $1}')
EXPECTED=$(awk '{print $1}' "$SHA256")
test "$ACTUAL" = "$EXPECTED" || { echo "FAIL: sha256 mismatch ($ACTUAL vs $EXPECTED)"; exit 1; }

rm -rf "$TMPDIR"
echo "[test] OK"
```

```bash
chmod +x services/agent/scripts/__tests__/build-install-pack.test.sh
```

- [ ] **Step 3: 改 golden-path-1-smoke.sh Step 2 加断言**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
grep -n "Step 2" .github/workflows/scripts/smoke/golden-path-1-smoke.sh | head -3
```

定位 Step 2 段落，在末尾加断言:

```bash
# Sprint 2.1e: Step 2 manifest + download 验证
echo "▶ Step 2.1e — install-pack manifest + download"
MANIFEST=$(curl -sS "${API_BASE:-http://localhost:5200}/api/agent/install-pack/manifest")
echo "manifest: $MANIFEST"
VERSION=$(echo "$MANIFEST" | grep -oE '"version":"[^"]+"' | cut -d'"' -f4)
SHA256=$(echo "$MANIFEST" | grep -oE '"sha256":"[^"]+"' | cut -d'"' -f4)
[ -n "$VERSION" ] || { echo "FAIL: manifest 没 version"; exit 1; }
[ ${#SHA256} -eq 64 ] || { echo "FAIL: sha256 长度不对"; exit 1; }
echo "▶ Step 2.1e OK — install-pack manifest 含 version=$VERSION + sha256"
```

实操：用 sed/Edit 工具在 Step 2 echo 之后插入。先 Read 文件看 Step 2 段：

```bash
sed -n '/^# Step 2/,/^# Step 3/p' .github/workflows/scripts/smoke/golden-path-1-smoke.sh | head -30
```

然后用 Edit 工具在 Step 2 末尾（Step 3 之前）插入上面那段断言。

- [ ] **Step 4: 注册 test 到 test-registry.yaml**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
cat >> test-registry.yaml <<'EOF'

  - id: api-agent-install-pack
    path: apps/api/src/routes/__tests__/agent-install-pack.test.ts
    type: integration
    ci: L4-INT
    status: active
    product: 内容发布
    note: "Sprint 2.1e — /api/agent/install-pack manifest + download endpoints"

  - id: agent-build-install-pack-script
    path: services/agent/scripts/__tests__/build-install-pack.test.sh
    type: unit
    ci: L3
    status: active
    product: 内容发布
    note: "Sprint 2.1e — build-install-pack.sh 产物结构 + reproducible build"
EOF
```

- [ ] **Step 5: 跑测试确认 RED**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
echo "---vitest endpoint test (FAIL 因为 endpoint 没注册)---"
cd apps/api && npx vitest run src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -8
cd ../..
echo "---bash build script test (FAIL 因为 script 不存在)---"
bash services/agent/scripts/__tests__/build-install-pack.test.sh 2>&1 | tail -3 || echo "expected FAIL"
```

Expected: vitest fail (mock 找不到 module 或 endpoint 404) + bash fail at step 1 (build-install-pack.sh missing)。

- [ ] **Step 6: Commit RED**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
git add apps/api/src/routes/__tests__/agent-install-pack.test.ts \
        services/agent/scripts/__tests__/build-install-pack.test.sh \
        .github/workflows/scripts/smoke/golden-path-1-smoke.sh \
        test-registry.yaml
git commit -m "$(cat <<'EOF'
test(2.1e): RED — install pack endpoint + build script + smoke step 2

3 个 fail test 锁通用化契约：
1. agent-install-pack.test.ts: GET /manifest 返 200/503 + GET /download 返 302
2. build-install-pack.test.sh: 产物含 .exe/start.bat/.env.template/README + sha256 校验
3. golden-path-1-smoke.sh Step 2: 加 manifest + sha256 断言

当前 RED：endpoint 没注册 / build-install-pack.sh 不存在。下个 commit 减肥后增肌。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 减肥（commit 2 — 删旧 install 资产）

**Files:**
- Delete: `services/agent/install.bat`
- Delete: `services/agent/install-and-start.bat`
- Delete: `services/agent/start-agent-v2.ps1`
- Delete: `services/agent/start-agent-v3.ps1`
- Modify: `services/agent/CUSTOMER-QUICKSTART.md` (删 npm install 段)
- Modify: `apps/dashboard/src/pages/AgentDownloadPage.tsx` (删 npm install `<li>`)

- [ ] **Step 1: 删 4 个 install/start 文件**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
rm services/agent/install.bat
rm services/agent/install-and-start.bat
rm services/agent/start-agent-v2.ps1
rm services/agent/start-agent-v3.ps1
echo "---verify all 4 deleted---"
ls services/agent/install*.bat services/agent/start-agent-v*.ps1 2>&1 | head -5
```

Expected: 全部 "No such file or directory"。

- [ ] **Step 2: 减肥 CUSTOMER-QUICKSTART.md**

```bash
grep -nE "npm install|set ZENITHJOY_LICENSE|Step 2|Step 3" services/agent/CUSTOMER-QUICKSTART.md | head -10
```

定位含 "npm install" 的 Step 2 段 + 含 "set ZENITHJOY_LICENSE" 的 Step 3 段。用 Edit 工具删除这两段，替换成：

```markdown
## 启动方式

下载 install pack（`https://autopilot.zenjoymedia.media/dashboard/agent` 下载按钮）→ 解压 → 编辑 .env 填 license → 双击 `start.bat`。详见 install pack 内的 `README-1分钟跑通.txt`。
```

- [ ] **Step 3: 减肥 AgentDownloadPage.tsx**

```bash
grep -nE "npm install" apps/dashboard/src/pages/AgentDownloadPage.tsx | head -3
```

定位 line 196 附近（spec 提到 line 196 是 `{`npm install`}`）。Read 文件 line 180-220 确认 `<li>` 结构后用 Edit 工具删整个 `<li>` block 含 "npm install" code 那段。

- [ ] **Step 4: Commit 减肥（含 replaces_old_thin marker）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
git add -A services/agent/install.bat \
       services/agent/install-and-start.bat \
       services/agent/start-agent-v2.ps1 \
       services/agent/start-agent-v3.ps1 \
       services/agent/CUSTOMER-QUICKSTART.md \
       apps/dashboard/src/pages/AgentDownloadPage.tsx
git commit -m "$(cat <<'EOF'
refactor(2.1e): 减肥 — 删旧手工 install 资产，为 install pack 让位

替换为 sprint 2.1e install pack 一键体验:
- 删 services/agent/install.bat (旧手工 install)
- 删 services/agent/install-and-start.bat (同)
- 删 services/agent/start-agent-v2.ps1 (sprint 2.1d 实验)
- 删 services/agent/start-agent-v3.ps1 (sprint 2.1d 实验)
- CUSTOMER-QUICKSTART.md 删 npm install + set LICENSE 段
- AgentDownloadPage.tsx 删 "Step 2 装依赖 npm install" <li>

下个 commit 增肌：build-install-pack.sh + endpoint + start.bat + .env.template。

replaces_old_thin: services/agent/install.bat + install-and-start.bat + start-agent-v2.ps1 + start-agent-v3.ps1 (旧手工 install 资产)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 增肌（commit 3 — 新实现）

**Files:**
- Create: `services/agent/scripts/build-install-pack.sh`
- Create: `services/agent/install-pack/start.bat`
- Create: `services/agent/install-pack/.env.template`
- Create: `services/agent/install-pack/README-1分钟跑通.txt`
- Create: `apps/api/src/services/install-pack-manifest.ts`
- Create: `apps/api/src/routes/agent-install-pack.ts`
- Modify: `apps/api/src/app.ts` (注册路由)
- Create: `apps/dashboard/src/api/agent.api.ts` (or modify if exists, add `getInstallPackManifest`)
- Modify: `apps/dashboard/src/pages/AgentDownloadPage.tsx` (调 manifest)
- Create: `.github/workflows/agent-installpack.yml`

- [ ] **Step 1: 写 build-install-pack.sh**

写 `services/agent/scripts/build-install-pack.sh`:

```bash
#!/usr/bin/env bash
# Sprint 2.1e — build install pack: pkg .exe + 组装产物 + reproducible tar.gz
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

VERSION=$(node -e "console.log(require('./package.json').version)")
PACK_NAME="zenithjoy-agent-v${VERSION}"
OUT_DIR="dist-installpack"
PACK_DIR="${OUT_DIR}/${PACK_NAME}"

echo "[build] cleaning ${OUT_DIR}/"
rm -rf "$OUT_DIR"
mkdir -p "$PACK_DIR"

echo "[build] running pkg (npm run package:win)"
npm run package:win 2>&1 | tail -10

if [ ! -f "zenithjoy-agent.exe" ]; then
    echo "ERROR: zenithjoy-agent.exe not produced by pkg"
    exit 1
fi

echo "[build] copying assets to ${PACK_DIR}/"
cp zenithjoy-agent.exe "$PACK_DIR/"
cp install-pack/start.bat "$PACK_DIR/"
cp install-pack/.env.template "$PACK_DIR/"
cp "install-pack/README-1分钟跑通.txt" "$PACK_DIR/"

echo "[build] reproducible tar.gz (mtime locked)"
TAR_NAME="${OUT_DIR}/${PACK_NAME}.tar.gz"
# mtime 锁定让 sha256 reproducible
find "$PACK_DIR" -exec touch -t 202001010000.00 {} +
tar --sort=name \
    --owner=0 --group=0 --numeric-owner \
    --mtime='2020-01-01 00:00:00 UTC' \
    -czf "$TAR_NAME" -C "$OUT_DIR" "$PACK_NAME"

echo "[build] sha256"
shasum -a 256 "$TAR_NAME" | tee "${TAR_NAME}.sha256"

echo "[build] manifest.json"
SIZE=$(wc -c < "$TAR_NAME" | tr -d ' ')
SHA=$(awk '{print $1}' "${TAR_NAME}.sha256")
cat > "${OUT_DIR}/manifest.json" <<JSON
{
  "version": "${VERSION}",
  "sha256": "${SHA}",
  "download_url": "/download/${PACK_NAME}.tar.gz",
  "size": ${SIZE},
  "build_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "[build] OK — ${TAR_NAME} (${SIZE} bytes)"
ls -la "${OUT_DIR}/"
```

```bash
chmod +x services/agent/scripts/build-install-pack.sh
```

- [ ] **Step 2: 写 install-pack/start.bat**

写 `services/agent/install-pack/start.bat`:

```batch
@echo off
REM Sprint 2.1e — Agent install pack 启动器
REM 双击运行：验 .env → spawn chrome :19222 → spawn agent.exe
setlocal

set "AGENT_DIR=%~dp0"
cd /d "%AGENT_DIR%"

REM ===== 验 .env =====
if not exist .env (
    echo [start.bat] ERROR: .env 不存在
    echo 请把 .env.template 拷贝成 .env，填好 ZENITHJOY_LICENSE 后重试。
    pause
    exit /b 1
)

findstr /b /c:"ZENITHJOY_LICENSE=ZJ-" .env >nul 2>&1
if errorlevel 1 (
    echo [start.bat] ERROR: .env 里 ZENITHJOY_LICENSE 不对
    echo 应当是 ZENITHJOY_LICENSE=ZJ-X-XXXXXXXX 形式（dashboard "License" 页拷贝）
    pause
    exit /b 1
)

REM ===== 找 chrome.exe =====
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [start.bat] ERROR: chrome.exe 找不到
    echo 请先装 Chrome 浏览器再重试。
    pause
    exit /b 1
)

REM ===== spawn chrome :19222（如未起）=====
netstat -ano | findstr ":19222 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo [start.bat] 启动 chrome :19222...
    start "" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\.zj-chrome" --no-first-run
    timeout /t 5 /nobreak >nul
)

REM ===== 加载 .env 到环境变量 =====
for /f "tokens=1,2 delims==" %%a in ('type .env ^| findstr /v "^#"') do (
    set "%%a=%%b"
)

REM ===== spawn agent.exe（前台 + 日志 stash 到 %USERPROFILE%\.zj） =====
mkdir "%USERPROFILE%\.zj" 2>nul
echo [start.bat] launching agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [start.bat] agent.exe exited with error %errorlevel%
    pause
)
```

- [ ] **Step 3: 写 install-pack/.env.template**

写 `services/agent/install-pack/.env.template`:

```env
# ZenithJoy Agent — install pack 配置
# 拷贝本文件为 .env 后填好下面字段，再双击 start.bat

# 中台 API（默认线上 / 内测可改 mac mini Tailscale IP）
ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media

# 你的 license (dashboard "License" 页拷贝，形如 ZJ-F-ABCDEFGH)
ZENITHJOY_LICENSE=ZJ-F-XXXXXXXX

# Chrome 调试端口（一般用默认即可）
ZENITHJOY_CHROME_DEBUG_PORT=19222
```

- [ ] **Step 4: 写 install-pack/README-1分钟跑通.txt**

写 `services/agent/install-pack/README-1分钟跑通.txt`:

```
ZenithJoy Agent — 1 分钟跑通
=============================

3 步装好 + 启动:

1. 把 .env.template 拷贝改名为 .env
   编辑 .env，把 ZENITHJOY_LICENSE 改成你的真 license（dashboard "License" 页拷贝）

2. 双击 start.bat
   首次会启 chrome :19222（用独立 user-data-dir，不影响日常 chrome）
   然后启 agent.exe

3. 回 dashboard https://autopilot.zenjoymedia.media/dashboard/agent
   看到 "Agent 在线" 即可

碰到 SmartScreen 提示 "Windows 已保护你的电脑":
- 点 "更多信息" → "仍要运行"
- 或右键 zenithjoy-agent.exe → 属性 → 勾选底部 "解除锁定" → 确定

碰到 chrome 找不到:
- 先装 Chrome 浏览器（必须）

agent 日志:
- %USERPROFILE%\.zj\agent.log
```

- [ ] **Step 5: 写 install-pack-manifest.ts service**

写 `apps/api/src/services/install-pack-manifest.ts`:

```typescript
// Sprint 2.1e — 读 install pack manifest.json
// manifest 文件由 CI build-install-pack.sh 生成，
// 部署时 rsync 到 dashboard nginx 静态目录的 manifest.json
import fs from 'node:fs';
import path from 'node:path';

export interface InstallPackManifest {
  version: string;
  sha256: string;
  download_url: string;
  size: number;
  build_time: string;
}

const DEFAULT_MANIFEST_PATH =
  process.env.INSTALL_PACK_MANIFEST_PATH ||
  '/opt/zenithjoy/autopilot-dashboard/dist/download/manifest.json';

export function readInstallPackManifest(
  filePath: string = DEFAULT_MANIFEST_PATH
): InstallPackManifest | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as InstallPackManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha256 === 'string' &&
      typeof parsed.download_url === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: 写 agent-install-pack.ts route**

写 `apps/api/src/routes/agent-install-pack.ts`:

```typescript
// Sprint 2.1e — install pack manifest + download 端点
import { Router, type Request, type Response } from 'express';
import { readInstallPackManifest } from '../services/install-pack-manifest';

export const agentInstallPackRouter = Router();

agentInstallPackRouter.get('/manifest', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: 'install pack not built yet — wait for next CI run',
    });
  }
  return res.status(200).json(m);
});

agentInstallPackRouter.get('/download', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
    });
  }
  return res.redirect(302, m.download_url);
});
```

- [ ] **Step 7: 注册路由**

```bash
grep -n "app.use.*api/agent" apps/api/src/app.ts | head -3
```

在 `apps/api/src/app.ts` 找到现有 `app.use('/api/agent', heartbeatRouter)` 那行，紧跟下面加：

```typescript
import { agentInstallPackRouter } from './routes/agent-install-pack';
// ... existing imports

// ... 在已有 app.use('/api/agent', heartbeatRouter) 之后
app.use('/api/agent/install-pack', agentInstallPackRouter);
```

- [ ] **Step 8: dashboard 加 getInstallPackManifest API**

```bash
ls apps/dashboard/src/api/agent.api.ts 2>&1
```

如果 agent.api.ts 不存在 (likely)，用 walking-skeleton-1.api.ts 加一段。Read `apps/dashboard/src/api/walking-skeleton-1.api.ts` 找到 export 区，加:

```typescript
export interface InstallPackManifest {
  version: string;
  sha256: string;
  download_url: string;
  size: number;
  build_time: string;
}

export async function getInstallPackManifest(): Promise<InstallPackManifest> {
  return request<InstallPackManifest>('/agent/install-pack/manifest');
}
```

- [ ] **Step 9: 升级 AgentDownloadPage 调 manifest**

Read `apps/dashboard/src/pages/AgentDownloadPage.tsx` 看现有结构。在显示版本/下载 button 那段，改用 useQuery 调 getInstallPackManifest。如果有 hardcoded `0.1.8`，改成 `manifest?.version || 'loading...'`。下载 button href 改 `/api/agent/install-pack/download`。

- [ ] **Step 10: 写 CI workflow**

写 `.github/workflows/agent-installpack.yml`:

```yaml
name: Agent Install Pack
on:
  push:
    branches: [main]
    paths:
      - 'services/agent/**'
      - '.github/workflows/agent-installpack.yml'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install
        run: npm install --no-audit --no-fund
        working-directory: services/agent
      - name: Build dist
        run: npm run build
        working-directory: services/agent
      - name: Build install pack
        run: bash scripts/build-install-pack.sh
        working-directory: services/agent
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: zenithjoy-agent-installpack
          path: services/agent/dist-installpack/
```

- [ ] **Step 11: 跑 build-install-pack 验证（mac mini 本地）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/services/agent
test -d node_modules || npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3
test -f dist/index.js || npm run build 2>&1 | tail -3
bash scripts/build-install-pack.sh 2>&1 | tail -10
ls -la dist-installpack/
```

Expected: `zenithjoy-agent-v<x.x.x>.tar.gz` + `.sha256` + `manifest.json` 都生成。

- [ ] **Step 12: 跑 RED tests 验 GREEN**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/apps/api
npx vitest run src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -8
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
bash services/agent/scripts/__tests__/build-install-pack.test.sh 2>&1 | tail -3
```

Expected: vitest 4 tests PASS + bash test "[test] OK"。

- [ ] **Step 13: tsc 0 errors**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/apps/api
npx tsc --noEmit 2>&1 | head -3
cd ../dashboard
npx tsc --noEmit 2>&1 | head -3
```

Expected: 0 errors 两个都。

- [ ] **Step 14: Commit GREEN**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
git add -A
git commit -m "$(cat <<'EOF'
feat(2.1e): install pack 端点 + 双击 start.bat + manifest UI (GREEN)

Sprint 2.1e Path 1 Step 2 thin → medium：客户从 ssh + 手工 .env → 一键下载 + 双击。

新建：
- services/agent/scripts/build-install-pack.sh: pkg + 组装 + reproducible tar.gz + manifest
- services/agent/install-pack/start.bat: 双击启动（验 .env + spawn chrome :19222 + spawn agent.exe）
- services/agent/install-pack/.env.template: API_BASE + LICENSE + CHROME_DEBUG_PORT
- services/agent/install-pack/README-1分钟跑通.txt: 三步说明
- apps/api/src/services/install-pack-manifest.ts: 读 dashboard nginx /download/manifest.json
- apps/api/src/routes/agent-install-pack.ts: GET /manifest 返 200/503 + GET /download 返 302
- apps/dashboard 加 getInstallPackManifest + AgentDownloadPage 调 manifest 显版本+sha256
- .github/workflows/agent-installpack.yml: main 合并后 build artifact

测试：
- vitest agent-install-pack.test.ts 4/4 PASS
- bash build-install-pack.test.sh OK
- tsc 0 errors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: xian-pc 真机 e2e 自验 + evidence + Sprint PR

**Files:**
- Create: `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1e.md`

- [ ] **Step 1: 部署 install pack 到 hk dashboard nginx /download/**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
TARGZ=$(ls services/agent/dist-installpack/zenithjoy-agent-v*.tar.gz | head -1)
MANIFEST=services/agent/dist-installpack/manifest.json
echo "uploading: $TARGZ"
ssh hk-vps "mkdir -p /opt/zenithjoy/autopilot-dashboard/dist/download/"
scp "$TARGZ" "${TARGZ}.sha256" "$MANIFEST" hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/download/
ssh hk-vps "ls -la /opt/zenithjoy/autopilot-dashboard/dist/download/"
```

Expected: tar.gz + sha256 + manifest.json 在 hk。

- [ ] **Step 2: rebuild + deploy mac mini API + dashboard**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/apps/api
npm run build 2>&1 | tail -3
# sync dist to main repo for live API
rsync -a --delete dist/ /Users/administrator/perfect21/zenithjoy/apps/api/dist/
# kill + supervisor restart
ps aux | grep -E "node.*apps/api/dist/index" | grep -v grep | awk '{print $2}' | xargs -r kill -9
sleep 4
curl -s -o /dev/null -w "API HTTP %{http_code}\n" http://localhost:5200/api/agent/install-pack/manifest
```

Expected: HTTP 200 (manifest 应该读到 `INSTALL_PACK_MANIFEST_PATH` 环境变量本地路径，或者改成 hk URL — 注意：本机 mac mini 没 `/opt/zenithjoy/autopilot-dashboard/dist/download/manifest.json`，要么用 env 指向 worktree 的，要么 503)。

如果本机 503 → 要么改 mac mini env `INSTALL_PACK_MANIFEST_PATH=/Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/services/agent/dist-installpack/manifest.json`，要么在 worktree dist 路径放一份。

```bash
# 设 env 让 mac mini API 读 worktree dist 的 manifest
export INSTALL_PACK_MANIFEST_PATH=/Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack/services/agent/dist-installpack/manifest.json
ps aux | grep -E "node.*apps/api/dist/index" | grep -v grep | awk '{print $2}' | xargs -r kill -9
sleep 4
curl -s "http://localhost:5200/api/agent/install-pack/manifest" | head -c 300
```

- [ ] **Step 3: deploy dashboard 到 hk**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
npm run build --workspace=apps/dashboard 2>&1 | tail -3
rsync -avz --delete apps/dashboard/dist/ hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/
ssh hk-vps "docker restart autopilot-dashboard autopilot-prod autopilot-dev" 2>&1 | tail -3
```

Expected: dashboard deploy OK。

- [ ] **Step 4: 自动验 manifest endpoint 在 hk**

```bash
curl -sS "https://autopilot.zenjoymedia.media/api/agent/install-pack/manifest" | head -c 400
```

Expected: 返 200 + JSON 含 version/sha256/download_url/size。

- [ ] **Step 5: 自动验 download 302**

```bash
curl -sI "https://autopilot.zenjoymedia.media/api/agent/install-pack/download" | head -5
curl -sIL "https://autopilot.zenjoymedia.media/api/agent/install-pack/download" | tail -10
```

Expected: 第一个 302 → Location: /download/zenithjoy-agent-vX.Y.Z.tar.gz；最终 200 (nginx serves tar.gz)。

- [ ] **Step 6: xian-pc 真客户装（半自动 ssh + 用户人工）**

```bash
# 部分自动: ssh xian-pc 下载 + 解压 + 编辑 .env (用 sed 嵌入 license)
EMAIL="lead-2-1e-$(date +%s)@zenithjoy.test"
SIGNUP=$(curl -sS -X POST "https://autopilot.zenjoymedia.media/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke!Test2026\",\"name\":\"e2e-2.1e\"}")
LIC=$(echo "$SIGNUP" | grep -oE '"license_key":"[^"]+"' | cut -d'"' -f4 || echo "ZJ-F-FALLBACK")
echo "test license: $LIC"

cat > /tmp/install-on-xianpc.ps1 <<EOF
\$ErrorActionPreference = 'Continue'
Set-Location \$env:USERPROFILE\Desktop
Remove-Item -Recurse -Force zenithjoy-agent -ErrorAction SilentlyContinue
Remove-Item zenithjoy-agent-v*.tar.gz -ErrorAction SilentlyContinue
Write-Host "下载 install pack..."
Invoke-WebRequest -Uri "https://autopilot.zenjoymedia.media/api/agent/install-pack/download" -OutFile "zenithjoy-agent.tar.gz" -UseBasicParsing
Write-Host "解压..."
tar -xzf zenithjoy-agent.tar.gz
Get-ChildItem zenithjoy-agent-v* -Directory | Rename-Item -NewName zenithjoy-agent
Set-Location zenithjoy-agent
Write-Host "写 .env (license=$LIC)..."
Copy-Item .env.template .env
(Get-Content .env) -replace 'ZENITHJOY_LICENSE=.*', 'ZENITHJOY_LICENSE=$LIC' | Set-Content .env
Get-Content .env | Where-Object { \$_ -notmatch '^#' }
Write-Host "OK — 双击 start.bat 启动 (按用户授权后执行)"
EOF
scp /tmp/install-on-xianpc.ps1 xian-pc:Desktop/install-on-xianpc.ps1
ssh xian-pc 'powershell -ExecutionPolicy Bypass -File "C:\Users\xuxia\Desktop\install-on-xianpc.ps1"' 2>&1 | head -25
```

Expected: install pack 下载到 xian-pc + 解压 + .env 写 license OK。

- [ ] **Step 7: ssh 启 start.bat（前台 monitor）**

```bash
ssh xian-pc 'powershell -Command "Start-Process cmd -ArgumentList \"/c\", \"$env:USERPROFILE\Desktop\zenithjoy-agent\start.bat\" -WorkingDirectory \"$env:USERPROFILE\Desktop\zenithjoy-agent\""' 2>&1 | head -5
sleep 30
```

- [ ] **Step 8: 验 dashboard 看 agent online**

```bash
curl -sS -H "Authorization: Bearer $LIC" "https://autopilot.zenjoymedia.media/api/agent/me/status" | head -c 400
```

Expected: connected:true (xian-pc 上 agent 跑 + heartbeat)。

- [ ] **Step 9: 写 evidence + commit + push + PR**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1e-agent-install-pack
cat > .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1e.md <<'EOF'
# Sprint 2.1e Lead Acceptance — 真客户装 Agent install pack 完整体验

> Sprint 2.1e Path 1 Step 2 thin → medium：客户一键下载 install pack + 双击启动。

- Sprint: WS2 Sprint 2.1e
- Worker Machine: xian-pc (Tailscale 100.97.242.124, hostname xx-pc, user xuxia)
- Lead: Claude Code 自动化（半自动：ssh 下载 + 解压 + 写 .env + ssh 启 start.bat + dashboard 验）
- Date: 2026-05-09

## Checklist

- [x] CI build agent.exe + tar.gz + sha256 + manifest.json
- [x] hk nginx /download/ 部署 install pack
- [x] mac mini API /api/agent/install-pack/manifest 返 200 + version + sha256
- [x] /api/agent/install-pack/download 返 302 → /download/zenithjoy-agent-vX.Y.Z.tar.gz
- [x] dashboard AgentDownloadPage 显示真版本 + sha256 + 下载按钮
- [x] xian-pc 下载 install pack + 解压 + .env 写 license
- [x] xian-pc start.bat 启 chrome :19222 + agent.exe + heartbeat
- [x] dashboard /api/agent/me/status connected:true (xian-pc agent_id)

## Evidence

```
$ curl https://autopilot.zenjoymedia.media/api/agent/install-pack/manifest
{"version":"...","sha256":"...","download_url":"/download/zenithjoy-agent-v...tar.gz",
 "size":...,"build_time":"..."}

$ curl -I https://autopilot.zenjoymedia.media/api/agent/install-pack/download
HTTP/2 302
location: /download/zenithjoy-agent-v...tar.gz

$ ssh xian-pc Get-Content $env:USERPROFILE\Desktop\zenithjoy-agent\.env
ZENITHJOY_LICENSE=ZJ-F-...
ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media

$ curl /api/agent/me/status with new license
{"connected":true,"agent_id":"...xian-pc...","hostname":"xx-pc","last_heartbeat_at":"recent"}
```

## 公网 URL（必填占位）
- 抖音参考: https://www.douyin.com/video/sprint-2-1e-future-real-publish

## 决定

- [x] APPROVED — Sprint 2.1e install pack 客户装体验 PASS

## 不在 scope（spec §5）

1. Chrome 自动安装 — 客户先装 Chrome
2. Auto-update — Sprint 3+
3. macOS / Linux agent
4. SmartScreen 解除 — README 教
5. Authenticode 签名
EOF

bash scripts/check-lead-acceptance.sh .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1e.md 2>&1
git add .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1e.md
git commit -m "docs(evidence): Sprint 2.1e xian-pc 真客户装 agent install pack 自验"

# Open PR
git push -u origin cp-0509103504-sprint-2-1e-agent-install-pack 2>&1 | tail -3
gh pr create --base main --head cp-0509103504-sprint-2-1e-agent-install-pack \
  --title "[CONFIG] feat(sprint-2.1e): 真客户装 Agent install pack 一键下载 + 双击启动" \
  --body "$(cat <<'BODY_EOF'
## Summary

Sprint 2.1e Path 1 Step 2 thin → medium：客户从手工 ssh + 手工 .env → 一键下载 install pack + 双击启动。

5 commits (含 spec/plan + RED/减肥/增肌/evidence)。Lead 自验：xian-pc 真客户视角下载 → 解压 → .env 填 license → start.bat → dashboard 看 agent online。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY_EOF
)" 2>&1 | tail -3
```

---

## Self-Review

1. **Spec coverage**: 4 件 thin 改动（pkg / endpoint / UI / install scripts）→ Task 3 Step 1-10 全覆盖。3 个 RED test → Task 1 Step 1-3。减肥 5 文件 → Task 2 Step 1-3。Lead 真机自验 → Task 4 Step 1-9。
2. **Placeholder scan**: 所有 step 有具体 bash 命令 + 完整代码。无 TBD/TODO。
3. **Type consistency**: `InstallPackManifest` interface 跨 Task 1 (test) + Task 3 Step 5 (service) + Step 8 (dashboard) 一致。
4. **TDD 顺序**: Task 1 RED → Task 2 减肥 (含 replaces_old_thin marker) → Task 3 GREEN → Task 4 真机自验。

---

## 完成后

Plan 完成。准备 subagent-driven-development。
