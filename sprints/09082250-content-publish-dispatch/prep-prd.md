# 小改动 PrepPRD：作品→发布任务派发接缝 + 统一发布包协议

> Brain task `7caeca00-d5dd-4d31-8412-d05ef077803a` · golden_path `c5c0e259`（line01 加厚刀1）
> 主理人已拍板（2026-09-08 对话："可以，你开始吧"，通道修正为安卓真机优先后继续推进）

## 改什么

apps/api 新增两个端点（复用 materials 的 X-Upload-Token license 鉴权）：

1. **POST /api/contents/:id/publish** — 作品一键拆发布任务
   - 校验作品属于本租户、platforms 非空（body.platforms 可覆盖 contents.platforms）
   - 复用 `findActiveAgentByTenantId`；无活跃 agent → 409 NO_AGENT（沿用 NoAgentError 语义）
   - 事务内：每平台一条 `publish_tasks`（agent_id / platform / type=作品形态 / status='queued' / tenant_id / payload=发布包）+ `contents.status='queued'`
   - 发布包 payload：`{content_id, title, body, content_type, platform, materials:[{id, storage_key, file_name, mime_type}]}`（不存签名 URL——2h 会过期，领取时现签）
2. **GET /api/publish-tasks/:id/package** — 执行器领任务时读发布包
   - license 鉴权 + 跨租户 404
   - 现签每个素材的临时下载 URL（复用 material-storage 已有签名能力）
   - 返回 `{title, body, content_type, platform, media:[{url, file_name, mime_type}]}`

## 为什么改

小程序上传的作品（contents）与发布链（publish_tasks）是两本账没接上；安卓真机通道（AI+skill，5 平台已验证）发布时标题文案是 AI 现编的。这一刀通了，"标题文案写一次→真机替你发"闭环成立，也是 Notion 编排台（刀2）的触发出口。

## 关联上下文

- Journey：line01 安卓端多平台自动发布（`24987ee5`，capability_code=android_worker_publish）
- golden_path：`c5c0e259`（统一内容源与编排发布闭环）
- 相关决策：9f297223（安卓 worker 发布立项）、e14297d4（控制塔/worker 概念）

## 影响范围

- 只新增路由与服务函数，不改既有 publish_tasks 消费方（folder_bind / qr_bind / work_id 老路径不动）
- contents 表只更新 status 字段值，无 schema 变更
- 判定点：无接缝判定点（纯服务端逻辑，N/A）

## 守卫

- 逻辑接缝 → CI vitest（本 PR 内，TDD 两段式 commit）
- COS 签名接缝 → 复用 material-storage 既有抽象与既有守卫，不新增
- feat PR smoke：`.github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh`（上传→拆任务→领发布包全链路断言）

## 验收标准

- [ ] commit-1：失败测试（dispatch 拆任务数=platforms 数、发布包字段齐、无 agent 409、跨租户 404、领取时签名 URL 可用）
- [ ] commit-2：实现转绿
- [ ] smoke 脚本进 CI（[CONFIG]）
- [ ] CI 全绿，PR 合并
- [ ] staging 真调：ZJ-E-ALEX5211 传素材→POST publish→GET package 断言 title/body/media.url 非空
