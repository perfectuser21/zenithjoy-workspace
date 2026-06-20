# 设计：微信 RPA 用 SPI 屏幕阅读器标志替代讲述人激活 UIA

日期：2026-06-14 · Journey：Line04 客户私域 AI 接管 · 决策：95d1124a · 类型：小改动（机制替换）

## 背景
微信 4.0 把 UI 自绘在 MMUIRenderSubWindowHW，只有"屏幕阅读器模式"开启后才暴露 mmui::MainWindow 控件树。
现实现靠启动 Windows 讲述人(Narrator.exe)打开该模式，但讲述人会在客户屏幕画满跟随焦点高亮框 + 朗读声，
严重干扰使用；且激活随时间失效需反复补。SPI_SETSCREENREADER 是讲述人背后真正的系统开关，
直接 ctypes 设置即可，纯系统调用、无窗口/无框/无声、进程退出后持久、不反向招起讲述人。
xian-pc 真机（微信 4.1.8.107）已验证：不开讲述人即读到 mmui::MainWindow + 92 控件。

## 范围与约束
- 仅改 Windows 真机微信 RPA 激活路径；非 Windows 走 dry-run 短路，不受影响。
- 硬约束不变：仅对微信 4.1.8.x 有效（4.1.10+ 控件树被腾讯移除）。版本守卫逻辑保持原样。
- 权威实现来源：找回的 .newfunc.tmp（新版 _activate_uia）。

## 改动清单（单元 + 边界）

### 1. listen_chat.py · `_activate_uia()`（约 1040-1075）
- **保持**：函数名、两个调用点（启动激活 + 失效后按 uia_reactivate_interval 补激活）、`-> None`、异常吞掉只 _log 的契约。
- **替换**：整个函数体的讲述人 PowerShell 三连（New-ItemProperty 禁弹窗 / Start-Process Narrator / Stop-Process Narrator）→ ctypes：
  ```python
  import ctypes
  SPI_SETSCREENREADER = 0x0047
  SPIF_SENDCHANGE = 0x0002
  ctypes.windll.user32.SystemParametersInfoW(SPI_SETSCREENREADER, True, None, SPIF_SENDCHANGE)
  ```
- docstring 更新为 SPI 说明（无框无声/持久/4.1.8.x）。

### 2. preflight.py · `check_uia_narrator()`（约 653-704，第 7 项自检）
- **保持**：注册键 `CHECK_NAMES[6] == "uia_narrator"`（内部 id，dashboard/测试引用，不改名）；dry_run/非 Windows → warn 短路；激活后 get_main_window() 验证逻辑。
- **删除**：Narrator.exe 存在性硬 fail 检查（SPI 不依赖 Narrator.exe，LTSC/精简版也能用）。
- **替换**：Start-Process/Stop-Process Narrator → ctypes 设 SPI 标志。
- **文案**：去掉"讲述人激活失败/未找到 Narrator.exe"，改为"屏幕阅读器标志设置失败"等；成功文案"屏幕阅读器模式已开（无需讲述人），UIAutomation 控件树可读"。

### 3. send_chat.py（约 108）
- detail 文案："微信未登录或讲述人解锁失效" → "微信未登录或 UIA 屏幕阅读器标志失效"。

### 4. 新增 tests/test_spi_activation.py（regression，永久留 CI）
- mock `ctypes.windll.user32` + `subprocess`：
  - 断言 `_activate_uia` 调用 `SystemParametersInfoW`，arg0 == 0x47(SPI_SETSCREENREADER)，arg1 is True。
  - 断言 `_activate_uia` 不再 spawn 任何含 "Narrator" 的 subprocess。
  - 断言 preflight `check_uia_narrator` 不再因 Narrator.exe 缺失而 failed；设标志成功 + 读到主窗口 → ok；读不到 → warn 且文案不含"讲述人"。

### 5. 双树同步 + 版本/打包
- 上述 1/2/3/4 的源文件改动必须 1:1 镜像到 `build-modules/line04/wechat-rpa/`（CI module-version-sync 回归测试强校验）。
- line04 module 版本 bump：`modules/line04/manifest.json` 1.0.28 → 1.0.29（+ build-modules manifest 同步）。
- 同步 required_version 断言：heartbeat-loop.ts / apps/api 相关测试 / smoke / wechat-rpa tests 里的版本号。
- 重新打包 dist-modules line04 tarball（禁止热替换 dist；见 memory feedback_agent_version_bump）。

## 测试策略
- **unit/regression**：test_spi_activation.py（上述断言，mock 化，CI 跑）。
- **integration**：preflight 自检在 dry-run 下返回 warn 不崩；module-version-sync 回归测试通过。
- **E2E（真机，部署后）**：xian-pc 杀掉讲述人 → 跑监听 → 仍读到 mmui::MainWindow、零框零声。CI 内无法真机，列为部署后人工/脚本验收。

## 错误处理
- ctypes 调用失败（非 Windows/权限）→ try/except 吞掉只 _log，不阻断监听主循环（沿用现契约）。
- preflight 设标志异常 → failed + 明确文案；读窗口异常 → warn（未登录属正常）。

## 验收
- grep 确认三源文件 + build 副本均无 `Start-Process Narrator`。
- test_spi_activation.py 先红后绿；CI 全绿。
- 版本号已 bump、tarball 已重打包。
