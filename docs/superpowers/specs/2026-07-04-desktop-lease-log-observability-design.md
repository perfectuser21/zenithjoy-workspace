# Design: listen_chat stderr 转发落盘（desktop-lease-broker 可观测性）

## 背景

PR#1085 把 DesktopLeaseBroker 接入了 `listen_chat.py` 真实回复主循环。真机验证时（xian-rog，v2.0.76 生产 agent）确认了 acquire/release 端点本身可用、优先级抢占语义正确，但发现关键日志（`[desktop_lease] acquire granted` 等）从 Python 子进程 stderr 输出后，只在 `services/agent/src/handlers/wechat-rpa.ts` 的 `startWechatListener()` 里被 `console.warn(...)` 打印——而 `module-manager.ts` fork 模块子进程时不监听其 stdout/stderr，这些 console 输出实际上写进了一个没有读者的 pipe 缓冲区，不落盘、不进 Brain，无法观测。本设计只补这一个可观测性缺口。

## 架构

```
listen_chat.py (Python, 真实回复主循环)
  → stderr: "[desktop_lease] acquire granted ..." / 其它诊断行
      ↓ (Node child_process spawn, stdio: ['ignore','pipe','pipe'])
startWechatListener() 里的 child.stderr.on('data', ...)
      ├─→ console.warn(...)          [不变，原有行为]
      └─→ appendListenChatLog(chunk)  [新增，本设计范围]
              ↓
          <agent配置目录>/logs/listen-chat.log   （持久化，跨 OTA 升级不丢，因为配置目录独立于按版本命名的模块目录）
```

## 组件

### 1. `getConfigDir()` 导出（`config-loader.ts`）

现有函数是模块内私有函数，已经封装好跨平台配置目录逻辑（`APPDATA` 优先 → win32 → darwin → 其它），本设计直接复用，只加 `export` 关键字，不改内部逻辑。

### 2. `appendListenChatLog(chunk: string): void`（新增，`wechat-rpa.ts`）

```
appendListenChatLog(chunk):
  try:
    logDir = path.join(getConfigDir(), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    logFile = path.join(logDir, 'listen-chat.log')
    if fs.existsSync(logFile) and fs.statSync(logFile).size > 5MB:
      oldFile = path.join(logDir, 'listen-chat.log.old')
      fs.renameSync(logFile, oldFile)   # 覆盖已有 .old（只留一代历史，够排障用）
    fs.appendFileSync(logFile, chunk)
  catch:
    pass   # 磁盘满/权限问题绝不能让 listen_chat 崩溃——沿用 console.warn 兜底即可
```

在 `child.stderr.on('data', (d) => { console.warn(...); appendListenChatLog(d.toString()); })` 里追加调用，一行改动。

## 数据流 / 边界

- **正常路径**：每次 stderr 有数据 → 追加写入 `logs/listen-chat.log`，日志按时间顺序自然堆叠。
- **磁盘写满/无权限**：`appendFileSync` 抛异常 → catch 静默吞掉，不影响 listen_chat.py 子进程本身运行（它是独立进程，Node 侧写日志失败不会传导过去）。
- **文件过大（客户机无人值守 24h 常驻）**：单文件超过 5MB 触发一次性轮转（重命名为 `.old`，覆盖上一代），不做无限历史保留——这是纯排障用途的日志，不是审计日志，不需要更复杂的按天轮转。
- **崩溃自愈重启**（`spawnOnce` 30s 后重新 spawn）：`appendFileSync` 天然是追加模式，重启后继续写同一个文件，不截断已有历史。
- **非 Windows**：`startWechatListener` 现有的 `process.platform !== 'win32'` 早退不变，本设计代码路径同样只在 Windows 生效。

## 测试策略

全部 unit test（Vitest），用 `process.env.APPDATA` 指向临时目录做隔离（沿用 `config-loader.ts` 现有测试隔离约定），不需要 integration/E2E（这是纯本地文件写入逻辑，没有外部依赖，没有新增 API 端点或 UI）：

1. `appendListenChatLog` 写入 chunk → 读文件内容确认包含该 chunk
2. 文件超过轮转阈值（用较小阈值参数化测试，或提前写入超量内容）→ 触发轮转 → 验证 `.old` 文件存在且内容为轮转前的内容，新文件内容为轮转后写入的内容
3. mock `fs.appendFileSync` 抛异常 → 调用 `appendListenChatLog` 不向上抛出异常（trivial 用例，纯粹保证 catch 生效）

无需 E2E test，这是补丁性质的可观测性小改动，不改变任何用户可感知行为。

## 不做的事

- 不做按天/按大小的多代日志滚动策略（超出本次范围，5MB 单文件+一代 `.old` 够用）
- 不把日志转发到 Brain（那是另一个更大的可观测性设计，本次只解决"本地能翻到"这个最小诉求）
- 不改 DesktopLeaseBroker 状态机、reply_in_chat_with_lease、registerLeaseBrokerRoutes 任何业务逻辑
