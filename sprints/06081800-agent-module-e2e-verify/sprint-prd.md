# Sprint PRD — Agent 模块化架构 E2E 验证

## OKR 对齐

- **对应 KR**：Path 1 Step 2（装客户端 + Agent 自动连中台）扩展验收 + Line 04 模块激活链路
- **当前进度**：06081603 + 06081700 代码已合并，完整激活链路 CI 验收缺失
- **本次推进预期**：激活链路 CI 全绿（windows_cloud + xian-rog 两 job）

## 背景

Sprint 06081603（preflight 协议 + 心跳双向 modules 扩展）和 06081700（Core 模块管理器 + line04 独立模块）代码已合并，但完整链路（Core 下载→preflight→IPC fork→module_status 回写）从未在 CI 自动验收。本 sprint 专门补这条 E2E。

## Golden Path（核心场景）

### 场景 A：首次安装（windows_cloud CI）

从 [运营员启用 line04] → 经过 [Core 下载→preflight→IPC fork→心跳上报] → 到达 [module_status DB 写入可读]

1. `POST /api/agent/heartbeat` 响应含 `modules: {line04-wechat-cs: {status:'active', required_version:'...'}}`（4 个 Line 全有）
2. ModuleManager.syncModules 收到 active module → 触发 downloadModule（CI 用 mock COS 或真实 COS）
3. `node modules/line04/preflight.js` 输出合法 JSON，非 Windows 跳过（exit 0）
4. activateModule fork `index.js` → 10s 内收到 `{type:'ready'}`
5. 带 `module_status:{line04-wechat-cs:{ok:true}}` 的心跳上报 → DB 持久化 → `GET /api/agent/module-health` 返回该记录

### 场景 B：xian-rog 真机验证

从 [真机 runner 触发] → 经过 [真实微信 4.1.8 + pywinauto + 内存检测] → 到达 [全通 exit 0 + 失败路径 exit 1]

1. `node modules/line04/preflight.js` 在真机跑三项检测，全通 exit 0
2. `MOCK_WECHAT_VERSION=4.2.0.0` 注入 → preflight exit 1，JSON 含 `fixGuide`（含 WeChatWin_4.1.8.exe COS URL）

## 边界情况

- 非 Windows 环境：preflight 跳过，输出合法 JSON + exit 0（CI 视为通过）
- xian-rog 微信被升级到高版本：version/版本 类失败只告警不判红，pywinauto/内存失败判红
- activateModule 超 10s 无 ready → exit 1（timeout）
- mock COS 返回 404 → downloadModule 上报 error，不 fork index.js

## 范围限定

**在范围内**：
- `agent-module-e2e-smoke.sh`：curl heartbeat modules + node ModuleManager + module_status DB（三 Step）
- `agent-module-e2e.yml`：windows_cloud job + xian-rog self-hosted job（两 job）
- preflight 失败路径（MOCK_WECHAT_VERSION env mock）

**不在范围内**：
- Dashboard 模块健康状态嵌入配置页（另立 sprint）
- line01/02/05 preflight 验证（本次只 line04）
- 多模块并发下载压测

## 假设

- [ASSUMPTION: COS 已有 line04-v1.0.0.tar.gz（CI build-line-modules job 已上传，PrepPRD 确认）]
- [ASSUMPTION: xian-rog self-hosted runner 已注册，label 含 wechat-capable]
- [ASSUMPTION: modules/line04/index.js 启动后通过 process.send({type:'ready'}) 通知父进程]
- [ASSUMPTION: preflight.js 已支持 MOCK_WECHAT_VERSION env 覆盖注册表读取（若不支持需补）]
- [ASSUMPTION: journey_id 待 Brain 恢复后从 initiative_runs 确认，预估对应 Line 04（客户私域 AI 接管）]

## 预期受影响文件

- `.github/workflows/scripts/smoke/agent-module-e2e-smoke.sh`：新增
- `.github/workflows/agent-module-e2e.yml`：新增（windows_cloud + xian-rog 两 job）
- `services/agent/modules/line04/preflight.js`：确认或补充 MOCK_WECHAT_VERSION env 支持

## journey_type: agent_remote
## journey_type_reason: 验证对象为 ZenithJoy Windows Agent 模块激活协议（services/agent/ IPC + heartbeat）
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Windows 产品走 GitHub Actions windows-latest；xian-rog self-hosted 作为第二 job（真机 preflight）
## journey_id: [ASSUMPTION: Line 04 客户私域 AI 接管，待 Brain 恢复后确认 UUID]
## step_id: [ASSUMPTION: L04-S1（Agent 模块激活链路），待 Brain 确认]
