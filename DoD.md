contract_branch: cp-07040431-ws-8594ef9a-ws1
sprint_dir: sprints/0703-line04-desktop-lease-broker

---
skeleton: false
journey_type: autonomous
target_environment: windows_wechat
---
# Contract DoD — Sprint: DesktopLeaseBroker 第一刀（Line04 Path4-Step5）

**范围**: DesktopLeaseBroker 状态机 + wechat-rpa.ts IPC 转发 + listen_chat.py acquire/release 集成
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/desktop-lease-broker.ts` 新建，导出 `DesktopLeaseBroker` 类
- [ ] [ARTIFACT] `services/agent/src/desktop-lease-broker.ts` 含 TTL 看门狗（setInterval）逻辑
- [ ] [ARTIFACT] `services/agent/src/handlers/wechat-rpa.ts` 注册 HTTP 路由 `POST /api/agent/desktop-lease-broker/e2e-watchdog-probe`
- [ ] [ARTIFACT] `services/agent/src/handlers/wechat-rpa.ts` 含 `desktop_lease_*` IPC 转发代码
- [ ] [ARTIFACT] `services/agent/wechat-rpa/listen_chat.py` 在 `_set_foreground_window` / `_open_chat` 前后有 acquire/release 调用
- [ ] [ARTIFACT] `sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts` 存在且含 acquire/watchdog 测试

## BEHAVIOR 条目

- [ ] [BEHAVIOR] B1 — Broker acquire 空闲状态 → granted:true
- [ ] [BEHAVIOR] B2 — TTL 超期后看门狗自动释放
- [ ] [BEHAVIOR] B3 — 非持有方 renew 返回 not_owner
- [ ] [BEHAVIOR] B4 — 低优先级 acquire 被拒返回 granted:false
- [ ] [BEHAVIOR] B5 — 重复 release 幂等
- [ ] [BEHAVIOR] B6 — listen_chat dryrun IPC 集成（接缝 1，xian-rog 真验）
- [ ] [BEHAVIOR] B7 — watchdog Brain log（接缝 2，xian-rog 真验）
- [ ] [BEHAVIOR] B8 — 高优先级抢占 onYield + ≤2200ms 强制授予
