# Sprint 合同：对话式创建 Skill

## 背景与目标

在现有员工工具（`/staff/skill-eval`）页面新增「创建 Skill」Tab，提供基于 SSE 流式对话的 skill 草稿创作体验：员工通过自然语言描述需求 → AI 多轮追问 → 说"生成吧"触发 mmv 上的 `claude -p --resume` 生成 skill zip → 自动提交评测 → 跳转报告页，全程支持断点续聊。

## Test Contract 表（核心约束）

| # | [BEHAVIOR] 描述 | 测试类型 | 测试文件路径 |
|---|---|---|---|
| 1 | POST /api/staff/skill-drafts 创建新草稿，返回 `{ id, status: "chatting" }`，DB 写入 skill_drafts 记录 | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 2 | GET /api/staff/skill-drafts/:id 返回历史 messages_json（含用户消息 + AI 回复），messages_json.length 等于实际消息条数 | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 3 | POST /api/staff/skill-drafts/:id/chat 响应 Content-Type: text/event-stream，至少收到 1 条 `data:` SSE 事件，最后发送 `event: done`（mock SSH 返回固定 stream-json） | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 4 | SSH 连接超时（>10s）时 /chat 端点发送 `event: error`，SSE 通道关闭，不挂起请求 | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 5 | POST /api/staff/skill-drafts/:id/generate 触发后：mock SSH skill-creator 返回 zip → mock upload 返回 job_id → skill_drafts.status='done' + skill_drafts.job_id 写入 DB | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 6 | skill_drafts 状态机覆盖全部路径：idle→chatting、chatting→generating、generating→done、generating→error，每条路径单独 unit 断言 | unit | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 7 | 所有 skill-drafts 路由受 staffGuard 保护：不带认证头返回 403 FORBIDDEN | unit | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 8 | Playwright Golden Path：staff 登录 → 点「创建 Skill」tab → 输入框可见 → 发送消息 → SSE 气泡出现 → 发送"生成吧" → 出现"正在生成..."→ mock generate 完成 → URL 含 job_id 参数 | e2e | `apps/dashboard/e2e/skill-create.spec.ts` |
| 9 | 断点续聊：POST /skill-drafts 建草稿 → 发 1 条消息等 SSE done → GET /skill-drafts/:id → messages_json.length === 2（用户消息 + AI 回复） | integration | `apps/api/src/routes/__tests__/skill-drafts.test.ts` |
| 10 | mmv 不可达时前端 SSE 收到 `event: error`，界面出现"AI 暂时连不上，稍后重试"文本，不出现无限 loading | e2e | `apps/dashboard/e2e/skill-create.spec.ts` |

## E2E 验收

Final E2E 分两层：

**integration 层（vitest）**：在 `apps/api/src/routes/__tests__/skill-drafts.test.ts` 中以 supertest 调真实 Express app，对 SSH/upload 用 vi.mock 替代，验证：SSE 转发、状态机、断点续聊、错误处理。目标：E2E-1 至 E2E-4（PRD 中四个 integration 验收场景）全通过。

**Playwright 层（windows_cloud CI）**：在 `apps/dashboard/e2e/skill-create.spec.ts` 中跑 E2E-5 Golden Path，用 `page.route` mock `/api/staff/skill-drafts/*` 全系 API，验证：Tab 可见 → 气泡渲染 → "正在生成..." → 最终 URL 含 `job_id`。

运行方式：
```bash
# integration
npx vitest run apps/api/src/routes/__tests__/skill-drafts.test.ts

# Playwright（windows_cloud CI / 本地）
VITE_SKIP_AUTH=true VITE_STAFF_EMAILS=staff@test.com npx vite --port 5173
npx playwright test e2e/skill-create.spec.ts
```

## 技术实现概要

1. **DB 表**：新建 `skill_drafts`（id UUID PK / session_id text / messages_json jsonb / status text / job_id text / created_at / updated_at）；status 枚举在应用层约束（chatting / generating / done / error）。
2. **后端路由**：在 `apps/api/src/routes/staff.ts`（或拆出 `skill-drafts.ts` 再在 `staff.ts` 挂载）新增 4 个端点，全部受现有 `staffGuard` 保护。
3. **SSE 转发**：`/chat` 端点通过 `child_process.spawn('ssh', ['mmv', 'claude', '-p', '--resume', session_id, '--output-format', 'stream-json'])` 拿到 stdout 流，逐行转成 `data: {...}\n\n` 推给前端；超时 10s kill 子进程并发 `event: error`。
4. **生成 + 提交**：`/generate` 端点 spawn SSH 触发 skill-creator 落地 zip，完成后 POST 内部 `/api/staff/skill-eval/upload`（复用现有上传路由），拿到 job_id 写回 DB。
5. **前端**：在现有 `SkillEvalPage` 加第二 Tab「创建 Skill」，对话 UI 用 EventSource 订阅 SSE；draft_id 存 `localStorage`（key: `skill_draft_id`）实现断点续聊；检测消息含"生成吧"时自动调 `/generate`。

## Out of Scope

- 验收报告页 6 维度重构（独立后续 sprint）
- 多模型逐线对比评估（独立后续 sprint）
- 技能库 Line→skill→版本三级下钻页（独立后续 sprint）
- 聊天历史全文检索 / 导出
- 多员工协作编辑同一草稿
- skill-creator 方法论本身的修改（已在 mmv 上验证，本 sprint 直接调用）
- 「评测上传」Tab 任何现有功能的变更
