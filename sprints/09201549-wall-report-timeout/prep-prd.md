# Bug PrepPRD：建任务请求超时 → 整单上报丢失 + 孤儿任务占住设备 10 分钟

Brain task `e1f3b464-7a1e-4ed0-bd27-c419a0411b4b` · 路径 A · GP-Anchor: `line02/keyword_acquisition keep-green`

## 症状

staging 控制塔「最近任务」里，0920 两单触达显示「失败 10分05秒 / 10分52秒 · executor_lost」，但 M4 的 `outreach.log` 显示同一单 1 分半就「✅ 送达」。连丢两单（12:34、13:33），14:22 之后才恢复正常。

## 根因（已实证，非假设）

M4 的 `~/phone-wall.log` 现场：

```
[0920-13:33:45] start ANGYVB4402004137 HTTP 000,静默降级
[0920-13:33:45] step ANGYVB4402004137 无进行中任务,忽略
...
[0920-13:35:14] done ANGYVB4402004137 无进行中任务,忽略
```

staging 库里同一时刻却有一条 running 任务 `3cf2b276`，两个步骤都是 `pending`、`current_step=0/2`。

链条：`wall-report` 的 `api()` 用 `curl -m 3` → 跨境网络抖动时 3 秒不够 → 服务端其实已 201 建好任务，响应回不来 → 客户端拿到 000 按设计「静默降级」删状态文件 → 后续 `step`/`done` 全部「无进行中任务,忽略」→ 服务端留下孤儿 running 任务 → 10 分钟租约过期判 `executor_lost`；期间该设备新任务 `start` 一律 409（清扫逻辑只扫本机状态文件，扫不到孤儿），于是连丢第二单。

同时段日志里大量 `frame HTTP 000` 与 `register 网络失败` 佐证网络抖动（xian-m4 有掉网史）。

## 修法

1. `wall-report.sh` 加 `API_TIMEOUT_WRITE="${WALL_API_TIMEOUT_WRITE:-8}"`：`start` 与 `complete` 这类「丢了就整单失联」的写操作用 8 秒（与 `register` 同档）；`step`/`note` 是高频心跳，丢一次无害，仍用 3 秒。
2. `do_start` 收到 `000` 时重试一次：第一次真失败则这次成功；第一次其实成功则这次拿 409，落进已有的清扫分支。

## Regression Test（已 commit，先红后绿）

- 「建任务响应慢于 3 秒仍能拿到 task_id」：假中台延迟 5 秒响应，断言只请求 1 次、状态文件写下、后续 step 正常上报
- 「建任务真超时 → 重试一次」：延迟 3 秒 + 注入写超时 1 秒，断言 tasks 端点收到 2 次请求、状态文件写下、日志无「静默降级」

变异自证：写超时改回 3 秒 → 第一条红；去掉 000 重试 → 第二条红。

## 不修（明确范围外）

孤儿任务本身无法被客户端回收（执行器面没有「按 agent 查 running 任务」的接口，加接口要改 API）。接受 10 分钟租约自愈；本修复把触发概率降到很低。

## 验收标准

- [x] failing test 先 commit
- [x] 修复让测试变绿（两种 bash 各 11/11）
- [x] 变异自证两处各自报红
- [ ] CI 全绿
- [ ] 部署 M4/M1 后观察一天：`phone-wall.log` 无「静默降级」、控制塔无新的 `executor_lost`
