# Sprint PRD — Agent 客户端封装（去黑窗 + 托盘静默通知）

## OKR 对齐

- **对应 KR**：Line 00 运营中枢 — 客户端可交付性（双击即起、零 terminal 暴露）
- **当前进度**：托盘 UI + 诊断上报链路已具备
- **本次推进预期**：把「Agent 客户端封装 去黑窗+静默通知」feature 从 ❌ 推到 ✅（thin）

## 背景

客户拿到机子双击启动后仍会弹 cmd 黑窗，模块出错提示用 PowerShell 气泡会闪窗，暴露"黑乎乎的代码窗口"，破坏交付体验。本 sprint 用 `start.vbs` 无窗口启动器 + node-notifier/原生 toast 静默通知根治，并补开机自启 / 单实例 / 降级红点 / 日志轮转 NFR。复用现有托盘 UI 与诊断自动上报链路（heartbeat→module_status→DB→/api/agent/module-health）。

## Golden Path（核心场景）

客户从 [双击 start.vbs] → 经过 [无窗口拉起 + 托盘感知 + 静默通知] → 到达 [全程无黑窗/无闪窗，仅靠托盘图标+图形通知感知状态]

具体：
1. 客户双击安装包里的 **`start.vbs`**（新入口）→ VBScript 无窗口拉起 start.bat → 全程**无 cmd/conhost 黑窗**，几秒后右下角出现 Agent 托盘图标
2. 客户右键托盘 → 看到「已连接中台 ●」+ 各模块状态 → 绿灯即确认，无需看任何 terminal
3. 某模块 preflight 失败 → 托盘弹一条**图形通知**（node-notifier/原生 toast）「微信 AI 客服：需要安装微信」→ **不闪 PowerShell 窗口**
4. 重启电脑 → 开机自启项指向 start.vbs，Agent 自动起来连中台，客户无需每次手动双击

<!-- Response Schema 由 Proposer 在 Step 1.1 推导；本 sprint 无新 API 端点。 -->

## 边界情况

- node-notifier 不可用 → 降级为托盘菜单**红点 + 日志**，**绝不**回退 PowerShell 弹窗
- start.vbs 拉起失败 → 写本地日志 `%APPDATA%\zenithjoy-agent\launch.log`，托盘不出现时客户凭日志报修
- 已运行时再次启动 → 单实例守卫，不重复拉起（防多开）
- launch.log 无限增长 → 大小轮转

## 范围限定

**在范围内**：start.vbs 无窗口入口；tray.ts showModuleError 弃 PowerShell 改 node-notifier/toast + 降级红点；开机自启注册；单实例；launch.log 轮转；打包进 install-pack；smoke。
**不在范围内**：诊断报告页（归「客户管理后台」sprint）/ 权限后台 / 安装包其它改造 / 托盘 UI 与诊断上报链路改动（已具备，仅复用）。

## 假设

- [ASSUMPTION: node-notifier 通过本 sprint 内 `npm i node-notifier` 安装，无外部凭据]
- [ASSUMPTION: 开机自启采用启动文件夹/注册表 Run 指向 start.vbs，由装机/打包逻辑注册]

## 预期受影响文件

- `services/agent/install-pack/start.vbs`：新增无窗口启动入口
- `services/agent/src/tray.ts`：showModuleError 去 powershell.exe，改 node-notifier/toast + 降级红点
- `services/agent/scripts/build-install-pack.sh`：产物纳入 start.vbs
- `.github/workflows/scripts/smoke/agent-client-encapsulation-smoke.sh`：新增 smoke
- `services/agent/package.json`：新增 node-notifier 依赖

## NFR 约束

<!-- 来源: PrepPRD「NFR（已与用户确认 2026-06-22）」主源；decisions category=nfr 副源为空 -->
- 开机自启：装机注册 Windows 启动项（启动文件夹/注册表 Run → start.vbs），开机即自动起 Agent 连中台
- 单实例：已运行时再次启动不重复拉起（防多开）
- 通知降级：node-notifier 不可用 → 托盘红点 + 日志，绝不回退 PowerShell
- 日志：launch.log 限大小轮转
- 无窗口：start.vbs / 子进程全程 windowsHide，无 cmd/conhost/powershell 可见窗口

## E2E 验收

> Planner 留占位；可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（.ps1，跑在 GHA windows-latest 干净 sandbox）。

```bash
# 占位：proposer 将填入 windows_cloud (.ps1) 真实脚本
# 期望验收点（自然语言）：
#  1. 双击/调用 start.vbs 启动 Agent → 进程树无 conhost/cmd 可见窗口（无黑窗）
#  2. 触发模块 preflight 失败 → 出图形通知，无 PowerShell 窗口闪现
#  3. node-notifier 不可用时降级托盘红点+日志，不回退 PowerShell
#  4. build-install-pack.sh 产物含 start.vbs；tray.ts 源码无 powershell 弹窗路径（grep 守卫）
```

## journey_type: agent_remote
## journey_type_reason: 改造的是跑在客户机上的 zenithjoy-agent 远端客户端（start.vbs 入口 + 托盘进程），属远端 agent 协议范畴
## target_environment: windows_cloud
## target_environment_reason: 无窗口启动 + Windows 原生通知为 OS 行为，须在 GitHub Actions windows-latest 干净 VM 验证
## journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
## step_id: L00-agent-client-encapsulation
