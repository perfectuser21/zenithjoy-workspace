# Bundle Node.js + HyperFrames into Agent Install Pack

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打入便携版 Node.js，让 agent install pack 在零依赖 Windows 机器上自动安装 HyperFrames，无需用户预装 Node.js 或 npm。

**Architecture:** CI 构建时从 npmmirror 下载 Node.js v20 便携 zip（约 28MB）并打入 tar.gz 包。用户首次运行 `start.bat` 时自动解压 Node.js 到 `%APPDATA%\ZenithJoy\runtime\nodejs\`，然后用内置 node.exe 通过 npmmirror 安装 hyperframes；`ensure-hyperframes.ts` 优先使用本地 `node.exe + hyperframes/dist/cli.js`，并设置 `PUPPETEER_EXECUTABLE_PATH` 使用系统已有 Chrome。

**Tech Stack:** bash (CI build), Windows batch + PowerShell (setup), TypeScript + vitest (unit tests), npmmirror CDN

---

### Task 1: 写失败的 ensure-hyperframes 单元测试（TDD commit-1）

**Files:**
- Create: `services/agent/src/handlers/__tests__/ensure-hyperframes.test.ts`

背景：`ensure-hyperframes.ts` 当前没有独立测试文件。新功能是 `getLocalHyperframesCmd()` 函数，需要测试：node.exe 存在时返回 `"<node.exe>" "<cli.js>"`，不存在时返回 null；`ensureHyperframes()` 找到 local cmd 时直接返回不调用 executor。

- [ ] **Step 1: 写失败的测试**

```typescript
// services/agent/src/handlers/__tests__/ensure-hyperframes.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// Mock fs.existsSync so we can control which files "exist"
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn() };
});

import fs from 'fs';
import { getHyperframesCmd, ensureHyperframes } from '../ensure-hyperframes';

const ZJ_RUNTIME = path.join(os.homedir(), 'AppData', 'Roaming', 'ZenithJoy', 'runtime');
const NODE_EXE = path.join(ZJ_RUNTIME, 'nodejs', 'node.exe');
const HF_CLI = path.join(ZJ_RUNTIME, 'hyperframes', 'node_modules', 'hyperframes', 'dist', 'cli.js');

afterEach(() => vi.restoreAllMocks());

describe('getHyperframesCmd', () => {
  it('node.exe + cli.js 都存在时返回 "node.exe" "cli.js" 组合命令', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      p === NODE_EXE || p === HF_CLI
    );
    const cmd = getHyperframesCmd();
    expect(cmd).toBe(`"${NODE_EXE}" "${HF_CLI}"`);
  });

  it('node.exe 不存在时返回 "hyperframes"（系统路径降级）', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getHyperframesCmd()).toBe('hyperframes');
  });

  it('cli.js 不存在（hyperframes 未安装）时返回 "hyperframes"', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === NODE_EXE);
    expect(getHyperframesCmd()).toBe('hyperframes');
  });
});

describe('ensureHyperframes', () => {
  it('本地路径存在时直接返回，不调 executor', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      p === NODE_EXE || p === HF_CLI
    );
    const mockExecutor = vi.fn();
    const cmd = await ensureHyperframes(mockExecutor as never);
    expect(cmd).toBe(`"${NODE_EXE}" "${HF_CLI}"`);
    expect(mockExecutor).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认测试失败（函数不存在）**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent
npx vitest run src/handlers/__tests__/ensure-hyperframes.test.ts 2>&1 | tail -20
```

预期：FAIL，提示 `getHyperframesCmd is not a function` 或 `not exported`

- [ ] **Step 3: commit-1（只有失败测试，无实现）**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs
git add services/agent/src/handlers/__tests__/ensure-hyperframes.test.ts
git commit -m "test(agent): TDD commit-1 — ensure-hyperframes local-node path tests (failing)"
```

---

### Task 2: 实现 ensure-hyperframes.ts + package.json version bump

**Files:**
- Modify: `services/agent/src/handlers/ensure-hyperframes.ts`
- Modify: `services/agent/package.json`

- [ ] **Step 1: 完整重写 ensure-hyperframes.ts**

```typescript
// services/agent/src/handlers/ensure-hyperframes.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

type Executor = (cmd: string, opts: { timeout: number; windowsHide: boolean }) => Promise<unknown>;

const ZJ_RUNTIME = path.join(os.homedir(), 'AppData', 'Roaming', 'ZenithJoy', 'runtime');
const ZJ_NODE_EXE = path.join(ZJ_RUNTIME, 'nodejs', 'node.exe');
const ZJ_NPM_CLI = path.join(ZJ_RUNTIME, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const ZJ_HF_DIR = path.join(ZJ_RUNTIME, 'hyperframes');
const ZJ_HF_MAIN = path.join(ZJ_HF_DIR, 'node_modules', 'hyperframes', 'dist', 'cli.js');

function getLocalHyperframesCmd(): string | null {
  if (fs.existsSync(ZJ_NODE_EXE) && fs.existsSync(ZJ_HF_MAIN)) {
    return `"${ZJ_NODE_EXE}" "${ZJ_HF_MAIN}"`;
  }
  return null;
}

export function getHyperframesCmd(): string {
  return getLocalHyperframesCmd() ?? 'hyperframes';
}

export async function ensureHyperframes(
  executor: Executor = (cmd, opts) => execAsync(cmd, opts),
): Promise<string> {
  // 1. 优先使用内置 Node.js + 本地安装的 hyperframes
  const localCmd = getLocalHyperframesCmd();
  if (localCmd) return localCmd;

  // 2. 检查系统 hyperframes
  try {
    await executor('hyperframes --version', { timeout: 5_000, windowsHide: true });
    return 'hyperframes';
  } catch { }

  // 3. 使用内置 node.exe + npm-cli.js 安装（start.bat 已解压 Node.js）
  if (fs.existsSync(ZJ_NODE_EXE) && fs.existsSync(ZJ_NPM_CLI)) {
    console.log('[hyperframes] 使用内置 Node.js 安装 hyperframes (npmmirror)...');
    try {
      await executor(
        `"${ZJ_NODE_EXE}" "${ZJ_NPM_CLI}" install hyperframes --prefix "${ZJ_HF_DIR}" --registry https://registry.npmmirror.com`,
        { timeout: 180_000, windowsHide: true },
      );
      const after = getLocalHyperframesCmd();
      if (after) {
        console.log('[hyperframes] 安装完成');
        return after;
      }
    } catch (err) {
      console.warn('[hyperframes] 安装失败:', (err as Error).message?.slice(0, 200));
    }
  }

  // 4. 降级：系统 npm
  console.log('[hyperframes] 降级到系统 npm 安装...');
  try {
    await executor(
      'npm install -g hyperframes --registry https://registry.npmmirror.com',
      { timeout: 120_000, windowsHide: true },
    );
    console.log('[hyperframes] installed via system npm');
  } catch (err) {
    console.warn('[hyperframes] install failed:', (err as Error).message?.slice(0, 200));
    console.warn('[hyperframes] video template rendering may fall back to plain resize');
  }
  return 'hyperframes';
}
```

- [ ] **Step 2: bump package.json 版本**

将 `services/agent/package.json` 第 3 行的版本从 `"1.1.4"` 改为 `"1.1.6"`：

```json
  "version": "1.1.6",
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent
npx vitest run src/handlers/__tests__/ensure-hyperframes.test.ts 2>&1 | tail -20
```

预期：4 tests passed

- [ ] **Step 4: typecheck 无报错**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent
npm run typecheck 2>&1 | tail -10
```

预期：无错误输出

- [ ] **Step 5: commit-2（实现 + 测试全绿）**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs
git add services/agent/src/handlers/ensure-hyperframes.ts services/agent/package.json
git commit -m "feat(agent): bundle Node.js runtime — use local node.exe for hyperframes (v1.1.6)"
```

---

### Task 3: 修改 build-install-pack.sh — 下载便携 Node.js

**Files:**
- Modify: `services/agent/scripts/build-install-pack.sh`
- Modify: `.gitignore`（根目录）

- [ ] **Step 1: 在 `build-install-pack.sh` 的 ffmpeg 逻辑后添加 Node.js 下载**

找到以下片段（第 56-57 行附近）：
```bash
cp install-pack/ffprobe.exe "$PACK_DIR/"
echo "[build] ffmpeg.exe + ffprobe.exe included in pack"
```

在其后添加：
```bash
echo "[build] ensuring portable Node.js for Windows..."
# Node.js portable zip from npmmirror (China-friendly CDN).
# Bundled so users with zero Node.js installed can get hyperframes on first run.
NODE_VERSION="20.18.0"
NODE_ZIP_NAME="node-v${NODE_VERSION}-win-x64.zip"
NODE_ZIP_URL="https://registry.npmmirror.com/-/binary/node/v${NODE_VERSION}/${NODE_ZIP_NAME}"
NODE_ZIP_CACHE="install-pack/${NODE_ZIP_NAME}"
if [ ! -f "$NODE_ZIP_CACHE" ]; then
    echo "[build] downloading portable Node.js ${NODE_VERSION} for Windows (~28MB)..."
    curl -L --retry 3 -o "$NODE_ZIP_CACHE" "$NODE_ZIP_URL"
    echo "[build] Node.js zip cached in install-pack/"
else
    echo "[build] Node.js zip already cached, skipping download"
fi
cp "$NODE_ZIP_CACHE" "$PACK_DIR/node-win-x64.zip"
echo "[build] node-win-x64.zip included in pack (portable Node.js for hyperframes)"
```

- [ ] **Step 2: 把 Node.js zip 加入 .gitignore**

在项目根目录 `.gitignore` 末尾追加（或在 services/agent/ 的相关区域添加）：

```
# Portable Node.js zip — downloaded at build time, not committed
services/agent/install-pack/node-v*-win-x64.zip
```

- [ ] **Step 3: 验证 build-install-pack.sh 语法**

```bash
bash -n /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent/scripts/build-install-pack.sh
echo "syntax OK: $?"
```

预期：`syntax OK: 0`

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs
git add services/agent/scripts/build-install-pack.sh .gitignore
git commit -m "feat(agent): build-install-pack — bundle portable Node.js v20 zip for Windows"
```

---

### Task 4: 修改 start.bat — 内置 Node.js + hyperframes 一键安装

**Files:**
- Modify: `services/agent/install-pack/start.bat`

- [ ] **Step 1: 替换 Step 5.5 段落**

定位并替换以下片段（第 108-126 行）：
```bat
REM Step 5.5: Install hyperframes npm package (needed for video template rendering)
where hyperframes >nul 2>&1
if not errorlevel 1 (
    echo [hyperframes] already installed
    goto :HYPERFRAMES_DONE
)
where npm >nul 2>&1
if errorlevel 1 (
    echo [WARN] npm not found - install Node.js from https://nodejs.org to enable video template rendering
    goto :HYPERFRAMES_DONE
)
echo [hyperframes] installing npm package...
npm install -g hyperframes --registry https://registry.npmmirror.com
if errorlevel 1 (
    echo [WARN] hyperframes install failed. Video template rendering will not be available.
) else (
    echo [hyperframes] installed OK
)
:HYPERFRAMES_DONE
```

替换为：
```bat
REM Step 5.5: 内置 Node.js + hyperframes（零依赖，国内加速）
set "ZJ_RUNTIME=%APPDATA%\ZenithJoy\runtime"
set "ZJ_NODE_DIR=%ZJ_RUNTIME%\nodejs"
set "ZJ_NODE_EXE=%ZJ_NODE_DIR%\node.exe"
set "ZJ_NPM_CLI=%ZJ_NODE_DIR%\node_modules\npm\bin\npm-cli.js"
set "ZJ_HF_DIR=%ZJ_RUNTIME%\hyperframes"
set "ZJ_HF_MAIN=%ZJ_HF_DIR%\node_modules\hyperframes\dist\cli.js"

if not exist "%ZJ_NODE_EXE%" (
    echo [nodejs] 首次设置：解压内置 Node.js 运行时...
    mkdir "%ZJ_NODE_DIR%" 2>nul
    powershell -NoProfile -Command "Expand-Archive -Path '%~dp0node-win-x64.zip' -DestinationPath '%TEMP%\zj-node-tmp' -Force; Move-Item '%TEMP%\zj-node-tmp\node-v20.18.0-win-x64\*' '%ZJ_NODE_DIR%\' -Force; Remove-Item '%TEMP%\zj-node-tmp' -Recurse -Force"
    if exist "%ZJ_NODE_EXE%" (
        powershell -NoProfile -Command "Unblock-File '%ZJ_NODE_EXE%'" >nul 2>&1
        echo [nodejs] Node.js 运行时就绪
    ) else (
        echo [WARN] Node.js 解压失败，视频模板渲染将使用基础 FFmpeg 模式
        goto :HYPERFRAMES_DONE
    )
)

if not exist "%ZJ_HF_MAIN%" (
    echo [hyperframes] 首次安装（约 1-2 分钟，通过 npmmirror 加速）...
    mkdir "%ZJ_HF_DIR%" 2>nul
    "%ZJ_NODE_EXE%" "%ZJ_NPM_CLI%" install hyperframes --prefix "%ZJ_HF_DIR%" --registry https://registry.npmmirror.com
    if errorlevel 1 (
        echo [WARN] hyperframes 安装失败，视频模板渲染将使用基础 FFmpeg 模式
    ) else (
        echo [hyperframes] 安装完成 OK
    )
) else (
    echo [hyperframes] 已安装，跳过
)
:HYPERFRAMES_DONE
```

- [ ] **Step 2: 在 Step 6 Chrome 验证后添加 PUPPETEER_EXECUTABLE_PATH**

定位以下片段（在 `:START_AGENT` 标签之后，Step 6 部分）：
```bat
REM Step 7: Spawn chrome :19222 if not already listening
```

在这行前（即 Step 6 找到 CHROME_EXE 的 if/else 块结束后）插入：
```bat
REM 让 hyperframes 的 puppeteer-core 使用系统 Chrome，避免重新下载 ~100MB Chromium
set "PUPPETEER_EXECUTABLE_PATH=%CHROME_EXE%"
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"
```

完整的 Step 6 + 新增行区域最终如下：
```bat
REM Step 6: Find chrome.exe
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [ERROR] chrome.exe not found. Please install Chrome browser first.
    pause
    exit /b 1
)

REM 让 hyperframes 的 puppeteer-core 使用系统 Chrome，避免重新下载 ~100MB Chromium
set "PUPPETEER_EXECUTABLE_PATH=%CHROME_EXE%"
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"

REM Step 7: Spawn chrome :19222 if not already listening
```

- [ ] **Step 3: 验证 start.bat 语法（Windows 专用，此处仅检查文本完整性）**

```bash
grep -n "HYPERFRAMES_DONE\|ZJ_NODE_EXE\|PUPPETEER_EXECUTABLE_PATH" \
  /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent/install-pack/start.bat
```

预期输出包含：
```
...ZJ_NODE_EXE...
...HYPERFRAMES_DONE...
...PUPPETEER_EXECUTABLE_PATH...
```

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs
git add services/agent/install-pack/start.bat
git commit -m "feat(agent): start.bat — extract bundled Node.js, auto-install hyperframes on first run"
```

---

### Task 5: 运行全套测试 + 推 PR

**Files:** 无新文件

- [ ] **Step 1: 运行完整 agent test suite**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent
npx vitest run 2>&1 | tail -30
```

预期：全部 pass，新增 ensure-hyperframes 测试 4 个

- [ ] **Step 2: typecheck**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent
npm run typecheck 2>&1 | tail -10
```

预期：无错误

- [ ] **Step 3: 检查 build-install-pack.sh 语法**

```bash
bash -n /Users/administrator/worktrees/zenithjoy/bundle-nodejs/services/agent/scripts/build-install-pack.sh
echo "exit: $?"
```

预期：`exit: 0`

- [ ] **Step 4: push + PR**

```bash
cd /Users/administrator/worktrees/zenithjoy/bundle-nodejs
git push -u origin cp-20260520-bundle-nodejs
gh pr create \
  --title "feat(agent): bundle portable Node.js v20 — zero-dep hyperframes install (v1.1.6)" \
  --body "$(cat <<'EOF'
## Summary

- Bundle portable Node.js v20 Windows x64 zip (~28MB) in the install pack
- `start.bat` Step 5.5: extract bundled Node.js on first run, install hyperframes from npmmirror (~1-2 min)
- `ensure-hyperframes.ts`: prefer local `node.exe + hyperframes/dist/cli.js` path, fallback chain preserved
- Set `PUPPETEER_EXECUTABLE_PATH` to system Chrome (already required), avoiding ~100MB Chromium re-download
- Version bump: 1.1.4 → 1.1.6 (1.1.5 already published to COS)

## Impact

Users with NO Node.js installed can now use video template rendering:
- 首次运行: start.bat 自动解压 Node.js + 安装 hyperframes (~1-2 min)
- 后续运行: 直接使用缓存，不重复安装

## Test plan

- [ ] Unit tests: 4 new ensure-hyperframes tests pass
- [ ] typecheck: no errors
- [ ] Manual (Windows): fresh machine, run start.bat, verify hyperframes installs and renders

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: 等 CI 通过后 merge**

```bash
gh pr list --head cp-20260520-bundle-nodejs
# CI 通过后：
gh pr merge --squash --delete-branch
```
