# Bundle Node.js + HyperFrames into Agent Install Pack — Design Spec

**Goal:** 让 agent install pack 在用户机器上零依赖（无需预装 Node.js）即可自动安装 HyperFrames，使视频模板渲染可用。

**Architecture:** 在 CI 构建时将便携版 Node.js Windows x64 zip（约 28MB）打入 tar.gz 包。用户首次运行 `start.bat` 时，自动解压 Node.js 到 `%APPDATA%\ZenithJoy\runtime\nodejs\`，然后用内置 Node.js 通过 npmmirror 安装 hyperframes 到 `%APPDATA%\ZenithJoy\runtime\hyperframes\`。Agent 进程调 HyperFrames 时使用系统已有 Chrome（Chrome 是 agent 运行的前置条件，已在 Step 6 验证），避免 puppeteer-core 重新下载 100MB Chromium。

**Tech Stack:** bash (CI), bat/PowerShell (Windows setup), TypeScript (ensure-hyperframes.ts), npmmirror CDN

---

## 方案选择

三种方案：

1. **（推荐）Bundle node.exe + 首次在线安装 hyperframes**
   - CI 下载 Node.js zip（28MB），打入 tar.gz
   - 首次运行时用内置 node 通过 npmmirror 安装 hyperframes
   - 优点：包体积增量小，hyperframes 在用户 Windows 机上本地 install，native binaries（sharp/onnxruntime）自动获取正确 Windows 版本
   - 缺点：首次运行需联网（1-2分钟）

2. 完全离线包（包含 hyperframes node_modules）
   - CI 上 npm install hyperframes for win32/x64，打包整个 node_modules
   - 缺点：包体积增加 ~100MB（hyperframes + native deps + puppeteer）；CI 需要 Windows 平台才能构建正确 native binaries

3. 用 Playwright 已有 Chromium 替代 puppeteer
   - 复杂，hyperframes 的 puppeteer-core API 与 Playwright 不完全兼容

**选择方案 1**，符合 YAGNI 原则，用户在中国可快速访问 npmmirror。

---

## 文件变更

### `services/agent/scripts/build-install-pack.sh`

在 ffmpeg 下载逻辑后新增：下载 Node.js v20 portable zip 从 npmmirror，缓存到 `install-pack/node-win-x64.zip`，并复制到 `PACK_DIR/node-win-x64.zip`。
URL：`https://registry.npmmirror.com/-/binary/node/v20.18.0/node-v20.18.0-win-x64.zip`

### `services/agent/install-pack/start.bat`

替换 Step 5.5（原来依赖系统 npm）为：
1. 检查 `%APPDATA%\ZenithJoy\runtime\nodejs\node.exe` 是否存在
2. 不存在则 PowerShell Expand-Archive 解压 `node-win-x64.zip`，将 `node-v20.18.0-win-x64\*` 提升到 `%APPDATA%\ZenithJoy\runtime\nodejs\`
3. Unblock-File node.exe（移除 MOTW）
4. 检查 `%APPDATA%\ZenithJoy\runtime\hyperframes\node_modules\hyperframes\dist\cli.js` 是否存在
5. 不存在则用内置 node.exe + npm-cli.js 安装 hyperframes（npmmirror）

在 Step 6（Chrome 验证）后添加：
```bat
set "PUPPETEER_EXECUTABLE_PATH=%CHROME_EXE%"
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1"
```

### `services/agent/src/handlers/ensure-hyperframes.ts`

新增 `getLocalHyperframesCmd()` 函数：
- 检查 `~\AppData\Roaming\ZenithJoy\runtime\nodejs\node.exe` + `~\...\hyperframes\node_modules\hyperframes\dist\cli.js`
- 两者都存在时返回 `"<node.exe>" "<cli.js>"` 组合命令
- 否则返回 null

`ensureHyperframes()` 优先级：
1. getLocalHyperframesCmd()（bundled node）
2. 系统 `hyperframes --version`
3. 用 bundled node + npm-cli.js 安装 hyperframes
4. 降级：系统 `npm install -g hyperframes`

### `services/agent/package.json`

bump version: `1.1.4` → `1.1.6`（1.1.5 已发布到 COS）

---

## 测试策略

| 测试类型 | 内容 | 文件 |
|---|---|---|
| unit | `getLocalHyperframesCmd()` 在 node.exe + cli.js 都存在时返回正确命令 | `src/handlers/__tests__/ensure-hyperframes.test.ts` |
| unit | node.exe 不存在时返回 null | 同上 |
| unit | `ensureHyperframes()` 调用 getLocalHyperframesCmd() 找到时直接返回，不调 executor | 同上 |
| trivial（manual E2E） | start.bat 在干净 Windows VM 上运行，node.exe 解压成功，hyperframes 安装成功 | 手动验证 |

`start.bat` / `build-install-pack.sh` 的 E2E 必须在真 Windows 机上验证，不在 CI Linux runner 上跑。

---

## .gitignore

`install-pack/node-v20.18.0-win-x64.zip` 需加入 `.gitignore`（大二进制，仅在 CI 下载/缓存）。
