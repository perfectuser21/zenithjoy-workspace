# Notion 发布编排台双向同步（line01 刀2）（2026-09-09）

## 任务简述

主理人要一个顺手的写作台：手机传素材→Notion 自动长行→填标题文案改状态"发"→系统派发（刀1链）→回执写回。本刀交付 notion-orchestrator 同步器（三方向 60s 轮询）+ 派发核心抽 service + notion-client 共享封装 + migration + 建库脚本。

### 根本原因（为什么长成这个形状）

- 编排台是"多入口写、单真相存"架构的第一个非 HTTP 入口——把刀1 的派发核心从 route 抽成 service 是必然动作，否则 worker 只能自己复制一份派发逻辑（复用即引用）。
- Notion 是外部不可信数据源：用户能手加 select option、能填错 content_id、能把终态行改回"发"。同步器的一半代码都是在防这些（白名单/UUID 锚校验/终态拒重派）。

### 下次预防

- [ ] 跨模块 mock 陷阱：service 抛的错误类如果 import 自被 vi.mock 整体替换的模块，instanceof 必失效——service 自定义错误类，route 翻译 HTTP。
- [ ] AxiosError 绝不整对象进日志/新 Error 的 cause：config.headers 带 Bearer token。统一在 client 层收敛成只含 status/response.data 的普通 Error。
- [ ] 轮询 worker 三件套：启动自检（缺 env 红日志跳过不 crash）、running 互斥（单轮超 interval 防重叠）、catch 不逃逸只打 message。
- [ ] 状态枚举当事实核：brief 里凭记忆写的 NON_TERMINAL 漏了 canonical 的 in_progress，靠"实现时对照 migration 核准"这道工序逮住——枚举类常量必须溯源到定义它的 migration。
- [ ] 外部视图（Notion 行）能被用户改出 spec 状态机之外的迁移（部分失败→发）：状态机设计时要问"用户手改字段能造出哪些非法迁移"，逐个拒绝并给人话原因。
- [ ] env-registry 闸真的会咬人：新增 process.env 读取必须同 PR 入册，这守卫这次真报红了（proven-to-fire 活体证明）。
