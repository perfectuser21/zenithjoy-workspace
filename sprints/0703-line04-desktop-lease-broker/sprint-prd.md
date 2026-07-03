# Sprint PRD — 桌面租约仲裁层（DesktopLeaseBroker）第一刀

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — RPA 稳定性
- **当前进度**：Path 4 Step 5（listen_chat 真发）已验收；多 agent 并发打断 = 未解决阻塞项
- **本次推进预期**：listen_chat 在多 agent 场景下不再被打断（单 client 验证协议正确性）

## 背景

同一台 Windows 机器上多个 line agent 各自调 RPA（键鼠/窗口切换），互相抢占前台导致输入
打断或发到错误窗口。当前无全局协调机制。

## Golden Path（核心场景）

listen_chat 操作微信窗口前申请租约 → 独占期间其他客户端不得操作 → 完成后归还

1. **入口**：listen_chat.py 窗口切换前发 `acquire`（priority=50，ttl_ms=10000，client_id="line04/listen_chat"）
2. **授予**：租约空闲 → `{granted:true, lease_id, expires_at}`；高优先级抢占 → 向持有方发 `yield`，等待≤2s 后强制授予；低优先级 → `{granted:false, retry_after_ms}`
3. **续期**：持有期间每 5s 发 `renew`，TTL 重置为 10000ms
4. **归还**：操作完成发 `release`，租约立即清除
5. **出口**：
   - 正常：消息发送完成，`release` 后其他等待方可立即申请
   - 崩溃：TTL 看门狗 10s 未收到 renew → 自动释放，写 Brain log `desktop_lease_watchdog_triggered`

## 边界情况

- 未 release 退出 / crash → TTL 看门狗兜底（≤15s 释放）
- 重复 release → 幂等，忽略
- 非持有方发 renew → `{ok:false, reason:"not_owner"}`
- acquire 超时仍未得租约 → 返回 `{granted:false}`，listen_chat 跳过本轮，不崩溃

## 范围限定

**在范围内**：
- `services/agent/src/desktop-lease-broker.ts`：Broker 状态机 + TTL 看门狗（setInterval 5s）
- `services/agent/src/handlers/wechat-rpa.ts`：IPC 转发 `desktop_lease_*` 消息到 Broker
- `services/agent/wechat-rpa/listen_chat.py`：在 `_set_foreground_window` / open_chat 前后加 acquire/release
- 单元测试（Broker 状态机纯逻辑）+ listen_chat 侧集成测试

**不在范围内**：Line01/Line02 接入；多 client 并发真实演示；持久化；Dashboard 可视化

## 假设

- [ASSUMPTION] Broker 以单例运行于 agent core 进程（Node.js）；listen_chat 经 wechat-rpa.ts IPC 通道交互
- [ASSUMPTION] 优先级：数字越小越高，0 保留给人工操作；listen_chat 默认 priority=50
- [ASSUMPTION] TTL=10000ms；看门狗轮询=5000ms；yield 等待上限=2000ms

## 预期受影响文件

- `services/agent/src/desktop-lease-broker.ts`（新建）
- `services/agent/src/handlers/wechat-rpa.ts`（修改，加 acquire/release 集成）
- `services/agent/wechat-rpa/listen_chat.py`（修改，加 acquire/release 调用）
- `services/agent/src/desktop-lease-broker.test.ts`（新建，单元测试）
- `services/agent/wechat-rpa/tests/test_listen_chat_lease.py`（新建，集成测试）

## NFR 约束

- 超时/延迟：acquire 响应 ≤200ms（本地 IPC，无网络）；抢占等待上限 2000ms
- 频控：看门狗 5s 轮询；不对 acquire 频率限制（幂等）
- 版本要求：微信 4.1.8（xian-rog 当前版本）
- 可观测：acquire/release/watchdog_trigger 均写 Brain log，带 tenant_id

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: Line04 已验收行为 + 已有代码注释提取（Brain 不可达，三源降级） -->
- [只被动回] listen_chat 只回名单内客户消息；broker 集成不改变此策略
- [防假成功] acquire 失败时跳过本轮，不得假装发送成功
- [租户隔离] lease 状态无租户字段（机器级锁）；操作日志须带 tenant_id
- [频控护栏] broker 不绕过 rate_limiter；acquire 成功后仍受 SENDER_COOLDOWN 约束
- [不留前台] release 后 agent core 不主动把任何窗口置于前台

## 累积 FR（本 line 已验收行为，本 sprint 不得回退）

<!-- 来源: Line04 已完成 sprints，从 sprints/ 目录名 + listen_chat 注释提取 -->
- 微信 UIA 监听: 扫未读 → 校验名单 → draft-generate → UIA 控件发送
- 无审批自动回: auto_reply.py 不经人工直接回（拟人延迟/路由/去重/告警）
- 人工优先: 前台=微信主窗口时跳过 AI 回复
- 可见发送验证: readback poll 确认气泡刷新，未刷新不判成功
- 租户隔离: cs_config_gate 按 machine_id+tenant_id 拉配置，拉失败强制 dryrun
- 每客服配置: auto_agent=false 时本机不发

## E2E 验收

> Proposer 按 target_environment=windows_wechat（xian-rog self-hosted runner）生成 ps1 脚本

```
# 期望验收点：
# Step 1 — vitest run desktop-lease-broker.test.ts 全绿（acquire/release/TTL/抢占状态机）
# Step 2 — python listen_chat.py --dryrun --inject-message '{"from":"客户A","text":"你好"}'
#           stderr 含 "[desktop_lease] acquire granted" + "[desktop_lease] release"
#           不含 "[desktop_lease] acquire failed"
# Step 3 — 看门狗：acquire 后不 renew，等 ≤15s，Brain log 含 desktop_lease_watchdog_triggered
# DoD：Step1+2+3 全通过，xian-rog 无 "acquire failed" 错误
```

## journey_type: autonomous
## journey_type_reason: 桌面租约 Broker 是后台守护层（无 UI），agent core 进程托管
## target_environment: windows_wechat
## target_environment_reason: listen_chat E2E 需要微信 4.1.8 已登录的 xian-rog self-hosted runner
## journey_id: line04（客户私域 AI 接管，Path 4）
## step_id: Path4-Step5（listen_chat 真发稳定性）
