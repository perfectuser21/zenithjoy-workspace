# Line04 回复稳定性重构 Phase 0（观测）设计

> 蓝图 `line04_reply_stability_scheduler_redesign_plan_0701` 的第一阶段。为 Phase 1（窗口管家+回主界面）打观测基础。

## 问题

同事的客户机没有 SSH，只能看中台「监听健康」看板。当前心跳 `diag` 上报了窗口/登录/会话数/未读/回复数，但**看不到两样关键信息**：

1. **模块版本** —— 无法确认这台机器跑的是哪版 line04（改完 Phase 1 后怎么判断有没有装上、是否退化）。
2. **每条未读为什么没回** —— 主循环已有结构化 skip（`dup/replied/cooldown/no_reply/direction/group/名单`），但只落本地日志文件（`_LOG_PATH`），中台完全看不到。同事看到"未读 5 条、回复 0 条"却不知道是"全 dup"还是"卡住了"。

## 目标

把「版本」和「每条 skip 原因」塞进**中台可见的心跳 `diag`**，不碰任何回复/扫描/切会话逻辑。纯增量观测。

## 架构（三个独立单元）

### 单元 1：模块版本透传（TS → Python env）
- `services/agent/modules/line04/index.ts`（或 `handlers/wechat-rpa.ts` 的 `startWechatListener`）spawn `listen_chat.py` 时，把 `manifest.version` 通过 env `ZENITHJOY_MODULE_VERSION` 传入。
- 依赖已有先例（`REAL_PUBLISH`/`ZENITHJOY_AGENT_ID`/`ZENITHJOY_MACHINE_ID` 都是这样传的）。
- **接口**：env 键 `ZENITHJOY_MODULE_VERSION`。缺失时 Python 侧记 `"unknown"`，绝不抛。

### 单元 2：skip 计数累加器（Python 纯逻辑）
- 新增一个小的计数器抽象（模块级 dict 或轻量对象）：`record_skip(reason)` 累加；提供「进程启动以来累计」+「本心跳周期增量」。
- **接口**：`record_skip(reason: str)` / `snapshot() -> {"total": {reason:count}, "delta": {reason:count}}`；`snapshot()` 后 delta 清零。
- 主循环现有 7 处 `skip(...)` 落日志的地方，各补一行 `record_skip("<reason>")`（不改判定，只多记一份）。
- **可独立单测**：喂 skip 事件序列 → 断言 total/delta 计数正确、快照后 delta 归零。

### 单元 3：diag 组装 + 版本注入（Python）
- 主循环心跳组装 `diag` 处（`listen_chat.py` ~2905）加两个字段：
  - `module_version`（读 env，缺=`"unknown"`）
  - `skip_reasons`（`{"total": {...}, "delta": {...}}`）
- 抽出纯函数 `build_diag(...)`（把现有散在心跳块里的 dict 组装收敛成可测函数），便于单测断言含新字段。
- `_log` 心跳行追加 `module_version=... skip=...` 便于本地肉眼看。

### 单元 4：stdout 时间戳（Python，微改）
- `_log` 的 `print(...)` 那行补 `[HH:MM:SS]`（写文件那行早有完整时间戳）。

## 数据流

```
manifest.version ──env ZENITHJOY_MODULE_VERSION──> listen_chat 启动读入
主循环每条未读 skip ──record_skip(reason)──> 计数器累加
每次心跳 ──build_diag(..., skip_counter.snapshot())──> diag{module_version, skip_reasons, ...}
       ──post_heartbeat──> 中台 /api/wechat/listener-heartbeat ──> 「监听健康」看板可见
```

## 错误处理

- 版本 env 缺失 → `"unknown"`，不抛。
- skip 计数器异常 → try/except 吞掉，心跳照发（观测绝不拖垮监听，沿用 `post_heartbeat` 现有纪律）。
- 中台端点 `diag` 是透传存储（JSON），新增字段无需改后端 schema。

## 测试策略

**档位：unit（本阶段）+ 真机验（Phase 2 统一做，本阶段不阻塞）。**

- **pytest 单测**（TDD commit-1 先红）：
  - `record_skip` / `snapshot`：喂事件序列断言 total/delta 计数与快照清零。
  - `build_diag`：给定 mock 输入 + env `ZENITHJOY_MODULE_VERSION` → 断言返回 dict 含 `module_version` 与 `skip_reasons` 结构。
- **vitest 单测**（TS 侧）：断言 `startWechatListener` spawn 的 env 含 `ZENITHJOY_MODULE_VERSION`=manifest 版本（复用现有 `listener-real-publish-env.test.ts` 同型断言）。
- **不做**：E2E/集成不适用（观测埋点无用户可交互面）；真机在 Phase 2 rog 清干净后统一验"心跳看板显示版本 + skip 计数"。

## 不包含

- 不改 skip 判定逻辑、不改回复/扫描/归位（那是 Phase 1）。
- 不改中台看板前端展示（后端透传即可，前端渲染另立小改动，若需要）。
- 不做层2机器协调器（Phase 3）。
