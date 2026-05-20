## Bundle Node.js + HyperFrames 到 Agent Install Pack（2026-05-20）

### 根本原因

用户机器完全没有 Node.js/npm → `start.bat` Step 5.5 的 `where npm` 检查失败 → 跳过 hyperframes 安装 → 视频模板渲染 fallback 到纯 FFmpeg，用户看不到 AI 渲染效果。代码静默失败（只打印 WARN），用户无法感知原因。

### 下次预防

- [ ] 新功能需要外部 runtime（Node、Python、ffmpeg 等）时，先问：用户机器可能完全没有装吗？如果答案是"可能"→ 必须打包或内置
- [ ] install pack 的依赖链：每次加新的 runtime 依赖都要走 build-install-pack.sh，不能假设用户已有
- [ ] `ensure-*.ts` 系列函数必须用 `process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')` 作为 AppData 路径 fallback（见 ensure-ffmpeg.ts 标准写法）
- [ ] Windows PowerShell 命令中传路径变量（如 `%VAR%`）时，若路径可能含空格，需用 `$var='%VAR%'` 然后引用 `$var`，不能直接在单引号内展开
- [ ] HyperFrames 用 puppeteer-core，第一次运行会下载 ~100MB Chromium；用 `PUPPETEER_EXECUTABLE_PATH` 指向系统 Chrome 可完全避免这个下载

### 关键决策

- Node.js v20 zip 从 npmmirror 下载（China-friendly，302 重定向到 cdn.npmmirror.com），而不是 nodejs.org（在中国可能慢）
- hyperframes 在用户真实 Windows 机上通过内置 node.exe 安装，native deps（sharp, onnxruntime-node）自动获取正确 Windows 版本，避免 CI 上 cross-compile 的复杂性
- Chrome 已是 agent 必须条件，直接复用，`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1` 防止意外触发下载
