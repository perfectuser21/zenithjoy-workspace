# 作品→发布任务派发接缝（line01 刀1）（2026-09-09）

## 任务简述

小程序/快捷指令上传的作品（contents）与发布链（publish_tasks）是两本账没接缝，安卓真机执行器发布时标题文案靠 AI 现编。本刀新增 POST /api/contents/:id/publish（拆任务+统一发布包）、GET /api/publish-tasks[/:id/package]（领单现签 URL）、getQueuedTasks 排除 content_publish（防旧 agent 误领）、全链路 smoke 进基线。

### 根本原因

- 素材链（materials/contents，2026-09-04 落地）与发布链（publish_tasks，walking-skeleton 时代）分别演进，从未定义"作品→任务"的翻译层；执行器侧因此只能现编内容。
- publish_tasks 是多消费方共用表（folder_bind/qr_bind/acquisition_cancel/burner…），新增任务类型时"谁会误领"必须当作一等设计问题：旧 agent 心跳 getQueuedTasks 按 agent_id 全量拉，不加服务端排除必然误领。

### 下次预防

- [ ] 给共用任务表新增 task_type 时，先 grep 全部消费方（getQueuedTasks/按 type 过滤的每一处），逐个判定"看见新类型会怎样"，排除逻辑与新类型同一个 PR 落地。
- [ ] 幂等检查一律进事务做 CAS（UPDATE … WHERE status<>x RETURNING），事务外读状态再写 = TOCTOU，审查必挑。
- [ ] 发布包类 payload 存 storage_key 不存签名 URL——签名有 TTL，派发与领取之间可能隔天；领取时现签。
- [ ] smoke 断言不许重言式：验证"旧通道看不见 X"必须真调旧通道端点（heartbeat），不许用一条恒真的 SQL 计数充数。
- [ ] 接受数组入参（platforms）时去重（Set），防同请求重复元素造成双发。
