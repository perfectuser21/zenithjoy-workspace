# 小改动 PrepPRD：listen_chat stderr（含 desktop_lease 日志）转发落盘

## 改什么
`services/agent/src/handlers/wechat-rpa.ts` 的 `startWechatListener()`：
- `child.stderr.on('data', ...)` 目前只 `console.warn(...)`，输出进了没人读的 pipe 缓冲区（module-manager fork 子进程时没监听其 stdout/stderr），desktop-lease-broker 的 `[desktop_lease] acquire granted/release` 等关键日志实际上无法被观测。
- 追加把同一份 data 同步 append 到落盘日志文件：`<agent配置目录>/logs/listen-chat.log`（配置目录复用 `config-loader.ts` 里 `getConfigDir()` 同款跨平台约定，需要把它导出）。
- 简单大小轮转：文件超过 5MB → 重命名为 `.old` 再另起新文件，防止无人值守客户机磁盘被日志撑爆。
- 写入失败（磁盘满/权限问题）→ try/catch 静默忽略，不能让 listen_chat 崩溃（沿用现有 console.warn 兜底行为不变）。
- 崩溃自愈重启（30s 后 `spawnOnce`）→ 用 append 模式打开文件，不截断历史。

## 为什么改
PR#1085 把 desktop-lease-broker 接入了真实回复主循环，真机验证时发现：唯一能观察"acquire/release 是否真的在生产里发生"的日志被写进了一个没人读的管道，不落盘、不进 Brain、看不到——没法证明真实客户消息触发了这套仲裁机制，也没法在未来任何排障场景里翻到证据。

## 关联上下文
- 相关 Journey/Ability：Line04 客户私域 AI 接管 / 桌面租约仲裁层(Desktop Arbiter)（feature_id 8358dd63-c0fe-4942-a2f5-d9b5d7c9e3bb）
- 相关历史决策：无直接匹配（decisions/match 查无），本次是真机验证过程中新发现的缺口

## 影响范围
- 只加日志落盘，不改 DesktopLeaseBroker 状态机、不改 acquire/renew/release 业务逻辑、不改 reply_in_chat_with_lease
- 不影响现有 console.warn 行为（保留，日志落盘是新增旁路）
- Windows-only（沿用 `startWechatListener` 现有的 `process.platform !== 'win32'` 早退）

## 验收标准
- [ ] 单测：`child.stderr` 收到数据 → 日志文件真的被写入（含内容）
- [ ] 单测：日志文件超过轮转阈值 → 触发轮转（旧文件重命名，新内容写入新文件）
- [ ] 单测：写入抛异常（mock fs 失败）→ 不向上抛出，listen_chat 逻辑不受影响
- [ ] CI 全绿
