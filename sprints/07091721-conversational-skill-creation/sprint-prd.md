# Sprint PRD：对话式创建 Skill（thin）

sprint_dir: sprints/07091721-conversational-skill-creation
task_id: 8541996f-7bc1-43c5-aac7-cec5ef8cb398
journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
feature_id: 6c4d4a5c-8f6b-4d0c-a8a3-b7ee2f680e91
ability_id: 16ac50db-bbc1-4b08-b922-97e251eb57f3

---

## Invariant 约束

无（Brain 查询返回该 Journey 无 invariants 字段；journey_type=dev_pipeline，无业务护栏限制）

---

## 累积 FR

无（Brain 中 feature 6c4d4a5c 尚未存入累积 FR，本次为新建 thin feature）

---

## NFR

- SSE 消息延迟：首字节 ≤ 3s（mmv SSH 建连 + claude CLI 启动合计）
- 断点续聊：draft_id 在浏览器 localStorage 持久化，刷新/次日打开历史可见
- mmv 不可达超时：SSH 连接超时阈值 10s，前端收到明确错误提示（不卡死轮询）
- 并发：thin 阶段单 draft 单会话，不要求多员工同时编辑同一 draft
- skill_drafts 表：状态机需 unit 测试覆盖（chatting → generating → done / error）

---

## Golden Path

1. **打开 Tab**：员工点击员工工具侧边栏，进入「创建 Skill」tab（与现有「评测上传」tab 并列）
2. **首轮对话**：输入需求描述 → 点击发送 → SSE 流式显示 AI 回复（claude -p 无头对话转发）
3. **多轮追问**：AI 追问细节，员工补充/纠正 → 历史消息滚动展示，持续流式回复
4. **说"生成吧"**：前端检测到触发词 → 后端在 mmv 用 `claude -p --resume <session_id> skill-creator` 生成 skill zip → 前端显示"正在生成..."进度状态
5. **自动提交评测**：后端把生成的 zip 程序化 POST 到 `/api/staff/skill-eval/upload` → 获得 job_id → 前端跳转到报告页等待评估结果
6. **断点续聊（出错-1）**：员工关闭浏览器 → 次日重新打开「创建 Skill」tab → 从 localStorage 恢复 draft_id → 历史消息从 skill_drafts 表加载，可继续聊
7. **连接失败（出错-2）**：mmv SSH 不通或 claude CLI 调用失败 → 前端 SSE 通道关闭 → 展示"AI 暂时连不上，稍后重试"明确提示，不卡死

---

## Feature 列表

### F1：「创建 Skill」Tab（thin）
- 在 `/staff/skill-eval` 页面（SkillEvalPage）增加第二个 Tab「创建 Skill」
- Tab 切换不刷新页面，不影响现有「评测上传」Tab

### F2：对话 UI（thin）
- 消息气泡列表（用户 / AI 两侧）+ 输入框 + 发送按钮
- SSE 流式渲染：AI 回复边收边显示，光标跟随滚动
- 触发词检测："生成吧"出现时自动触发 F4

### F3：skill_drafts 表 + 后端 API（thin）
- 新建 DB 表 `skill_drafts`（id / session_id / messages_json / status / job_id / created_at / updated_at）
- `status` 枚举：`chatting` → `generating` → `done` | `error`
- 新增路由（staffGuard 保护）：
  - `POST /api/staff/skill-drafts` — 创建 draft，返回 draft_id
  - `GET  /api/staff/skill-drafts/:id` — 拉取历史消息
  - `POST /api/staff/skill-drafts/:id/chat` — 发送消息，返回 SSE 流（转发 mmv claude -p --resume）
  - `POST /api/staff/skill-drafts/:id/generate` — 触发生成 + 提交评测

### F4：mmv SSH + claude -p --resume 转发（thin）
- 后端通过 `ssh mmv` 执行 `claude -p --resume <session_id> --output-format stream-json`
- 把 claude CLI 的 stream-json 输出转为 SSE 事件推给前端
- SSH 连接超时 10s；claude 调用失败 → SSE 发送 `event: error` → 关闭连接

### F5：生成 + 程序化提交（thin）
- 说"生成吧"后：`ssh mmv` 触发 skill-creator 在 mmv 上落地生成 skill zip
- 生成完成后后端自动调用内部 `/api/staff/skill-eval/upload` 提交
- 提交成功 → 把 job_id 存入 `skill_drafts.job_id`，前端跳转报告页

### F6：断点续聊（thin）
- draft_id 存 localStorage（key: `skill_draft_id`）
- 打开 Tab 时读取 draft_id → GET /skill-drafts/:id 恢复历史消息

---

## 不包含（Out of Scope）

- 验收报告页 6 维度重构（独立后续 sprint）
- 多模型逐线对比评估（独立后续 sprint）
- 技能库 Line→skill→版本三级下钻页（独立后续 sprint）
- 聊天历史全文检索 / 导出
- 多员工协作编辑同一草稿
- skill-creator 方法论本身的修改（已在 mmv 上验证，本 sprint 直接调用）

---

## 验收标准（Final E2E）

### E2E-1：SSE 链路连通（unit + integration）
```
POST /api/staff/skill-drafts/:id/chat
→ 响应 Content-Type: text/event-stream
→ 收到 ≥1 条 data: {...} SSE 事件（mock SSH 返回固定 stream-json）
→ 连接正常关闭（event: done）
断言：HTTP 200 + Content-Type includes "text/event-stream" + 至少 1 个 data 行
```

### E2E-2：mmv 不可达错误处理（integration）
```
mock SSH 连接超时（10s）→ 前端 SSE 收到 event: error
→ 前端界面显示"AI 暂时连不上，稍后重试"
→ 不出现无限 loading / 空白页
断言：page.locator('text=AI 暂时连不上') toBeVisible { timeout: 15000 }
```

### E2E-3：断点续聊（integration）
```
1. POST /skill-drafts → 得到 draft_id
2. POST /skill-drafts/:id/chat 发 1 条消息，等待 SSE done
3. GET  /skill-drafts/:id → messages_json 包含该消息
断言：messages_json.length === 2（用户消息 + AI 回复）
```

### E2E-4：生成 + 提交评测（integration，mock mmv + mock upload）
```
mock ssh mmv skill-creator → 返回 /tmp/test-skill.zip（固定 4 字节）
mock POST /api/staff/skill-eval/upload → 返回 { job_id: "gen-job-001" }
POST /skill-drafts/:id/generate
→ skill_drafts.status = "done"
→ skill_drafts.job_id = "gen-job-001"
断言：DB 查 skill_drafts WHERE id=:id → status='done' AND job_id='gen-job-001'
```

### E2E-5：Playwright 前端 Golden Path（windows_cloud）
```
1. staff 账号登录 → 侧边栏「员工工具」可见
2. 点「创建 Skill」tab → 输入框可见
3. 发送一条消息 → 气泡出现 + SSE 流式文字可见（mock API）
4. 发送"生成吧" → 出现"正在生成..."状态提示
5. mock generate 完成 → 页面跳转到报告页 /staff/skill-eval?job_id=gen-job-001
断言：全部 expect().toBeVisible() 通过；最终 URL 含 job_id 参数
```

### E2E-6：CI 全绿
```
vitest unit：skill_drafts 状态机（chatting → generating → done/error）4 条路径全覆盖
vitest integration：mock SSH + mock upload，验证 SSE 转发 + 提交链路
Playwright（windows_cloud）：E2E-5 全通过
```

---

journey_type: staff_tool
target_environment: windows_cloud
