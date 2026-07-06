# 设计：line04 桌面租约 Broker 不可达降级放行 + 死参数清理（1.0.110）

日期：2026-07-06 ｜ Issue：6e890bf6 ｜ Task：51aed1e9 ｜ Journey：Line04
用户已拍板：方案 A（Broker 联系不上 → 降级放行，决策 f26e099c）。

## 背景（与 #1142 的关系）
租约打错地址（middleware→本机 IPC）的主修已由 PR #1142 合入 main（1.0.109，
`_get_local_discovery_base()`）。本 PR 是它之上的**增量**，补齐 #1142 没做的两件事：

1. **降级放行（用户拍板，#1142 未实现）**：main 上 acquire 异常仍 `return False`
   （硬阻断）——老 core（无 Broker 路由）/core 未起的客户机会永久不回复，等于
   6e890bf6 换个姿势重演。本 PR：任何异常（连接拒绝/超时/404/解析失败）→
   `[desktop_lease] broker unreachable -> degrade-allow` 警告 → 返回 True
   （行为回 1.0.102，不断回复）；显式 `granted:false`（桌面被占）→ 仍 False 跳过。
2. **死参数清理 + AST 防回归守卫**：acquire/release/renew 仍带未使用的
   `middleware_url` 形参（误导下个改代码的人接回中台）。删参数、改 4 处调用点，
   并加 AST 守卫测试：desktop_lease_* 函数体（含形参）永久禁止出现 `middleware_url`。

## 测试策略
- **unit（pytest，commit-1 先红）**：`test_desktop_lease_ipc.py`
  AST 守卫（main 上红：形参还在）+ 降级语义×3（main 上红：异常→False/签名带参）
- 同步翻转 main 上锁旧语义的 `test_listen_chat_lease.py::test_acquire_http_error_returns_false_and_logs`
  →降级放行断言（随 impl commit）
- **E2E（真机，merge 后）**：rog OTA 1.0.110 → 默忆 DELIVERED；降级 proven-to-fire：
  rog 死端口（ZENITHJOY_LOCAL_PORT=1）单跑 acquire 亲眼看 degrade-allow。

## 版本 bump（1.0.109 → 1.0.110，9 面）
manifest×2 / walking-skeleton.service.ts(+test) / heartbeat-modules.test.ts / smoke×4；
build-modules/line04/wechat-rpa 镜像随 impl commit rsync 同步。

## 不做
不动 Broker（core）；不动中台；不动 renew 逻辑（仅清参数）；重试队列过期另案（台账 §2.I）。
