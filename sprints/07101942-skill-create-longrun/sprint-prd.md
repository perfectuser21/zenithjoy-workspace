# Sprint PRD：对话式创建 Skill — 后台长跑生成改造

sprint_dir: sprints/07101942-skill-create-longrun
task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
created_at: 2026-07-10
journey: ZenithJoy 运营中枢（636a918c-8b23-4df5-baec-b1eb3308fffb）
feature: 对话式创建 Skill（现有 feature 加厚，medium → 异步长跑，不升厚度标签）
journey_type: internal_tooling
target_environment: windows_cloud

---

## 背景与目标

现有 `/generate` 端点在 HTTP 请求内同步 `spawn` 子进程并等待 skill-creator 跑完（最多 5 分钟超时），一旦超时或网络抖动，整个生成过程就失败，员工必须重新开始。

本 sprint 把生成逻辑从"同步等待"改为"后台长跑"：点"开始吧"后 API 立即返回，后台 detached 子进程自主跑完整创建流程，前端每 5-10 秒轮询状态，员工可以离开页面。若 AI 在生成过程中需要员工决策，通过 `needs_input` 状态暂停并等回答，员工提交答案后自动继续。

---

## 状态机（新版，权威定义）

```
chatting ──GENERATE──→ running ──DONE──→ done（终态）
   ↑                     │
   │                     ├──NEEDS_INPUT──→ needs_input
   │                     │                    │
   │                     │           ANSWER_SUBMITTED
   │                     │                    ↓
   │                     └──────────────── running
   │
error ←──ERROR──── running
   │
RETRY（重新点"开始吧"）→ running
```

状态枚举：`chatting` | `running` | `needs_input` | `done` | `error`

（原 `generating` 状态废弃，迁移为 `running`；`idle` 状态在此 sprint 同步废弃）

---

## 新增 DB 字段（migration）

表：`zenithjoy.skill_drafts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `pending_question` | `text` | AI 暂停时写入的问题；`needs_input` 时非 null |
| `result_json` | `jsonb` | 终态数据：`{zip_path}` 或 `{error_message}` |
| `callback_token` | `text` | 子进程回调校验 token（UUID，per-job） |

migration 文件：`apps/api/db/migrations/20260710_194200_skill_drafts_longrun.sql`

---

## 新增 API 端点

### POST `/:id/generate`（改造）
- 校验状态为 `chatting` 或 `error`，否则返回 409（互斥锁）
- 生成新 `callback_token`（UUID），写入 DB
- 状态转 `running`，立即返回 `{status: "running"}`
- 在进程内 `spawn` detached 子进程（`--resume` 复用 session），传入 `CALLBACK_URL` 和 `CALLBACK_TOKEN` 环境变量，调用后直接 `unref()` 让子进程脱离父进程生命周期

### POST `/:id/answer`（新增）
- 校验状态为 `needs_input`，否则返回 409
- 将员工回答写入 DB（附加到 `messages_json`，清空 `pending_question`）
- 生成新 `callback_token`，状态转 `running`
- 重新 `spawn` detached 子进程（`--resume`，把回答当首条新消息喂入）

### POST `/internal/skill-drafts/:id/callback`（新增，内部）
- **不受 staffGuard 保护**，受 `callback_token` 校验保护
- 子进程完成时调用，body：`{token, event, zip_path?, question?, error_message?}`
- `event` 枚举：`done` | `needs_input` | `error`
- 校验 `token === draft.callback_token` 且 `token` 未过期（TTL 2小时），否则 400
- 根据 event 更新状态、写入 `result_json` 或 `pending_question`

### GET `/:id`（扩展响应）
- 新增字段：`pending_question`、`result_json`
- 若 `status === running` 且 `updated_at` 超过 2 小时，自动转为 `error`，`result_json.error_message = "生成超时（2小时无响应）"`，并返回 `error` 状态（软超时兜底）

---

## 前端改造（`apps/dashboard`）

- "开始吧"按钮点击后：POST `/:id/generate` → 立即显示"生成中"横幅
- 轮询：`running` 或 `needs_input` 状态下每 8 秒 GET `/:id` 一次
- `needs_input` 状态：显示 `pending_question` 文本 + 答案输入框 + "提交"按钮
- `done` 状态：显示"已完成"+ 根据 `result_json.zip_path` 渲染下载链接
- `error` 状态：显示 `result_json.error_message` + "重新开始"按钮（重置为 `chatting`）

---

## Invariant 约束

1. **互斥锁**：`status=running` 时调用 `POST /:id/generate` 必须返回 409，且不产生第二个子进程（spawn 调用次数严格为 0）
2. **互斥锁-2**：`status=needs_input` 时调用 `POST /:id/generate` 必须返回 409
3. **callback_token 校验**：token 不匹配或草稿不存在时，`POST /internal/.../callback` 返回 400，且 draft 状态不改变
4. **软超时兜底**：`GET /:id` 时若 `status=running` 且 `updated_at` 超过 2 小时，响应必须返回 `status=error`，且 `result_json.error_message` 含超时信息
5. **状态终态封闭**：`status=done` 时任何 action（GENERATE / ANSWER_SUBMITTED / callback）均不改变状态
6. **detached 脱离**：子进程必须调用 `unref()` 脱离父进程，父进程退出不杀子进程
7. **`needs_input` 转移合法性**：只有 `status=needs_input` 时 `POST /:id/answer` 合法，其他状态返回 409
8. **错误可恢复**：`status=error` 时员工点"重新开始"（POST `/:id/generate`）必须合法转为 `running`
9. **callback_token 单次绑定**：同一个 token 的 callback 只能被接受一次（接受后立即清空或置 used，第二次同 token 调用返回 400）
10. **前端轮询不阻塞离开**：`running`/`needs_input` 状态下前端轮询不依赖持续打开的 SSE 连接，用户关闭标签页后后台进程继续运行（通过 detached spawn 保证）

---

## 累积 FR

| # | 端点/模块 | 行为描述 | 对应 Invariant |
|---|-----------|----------|---------------|
| FR-01 | POST `/:id/generate` | `chatting`/`error` 状态下合法触发：状态→`running`，spawn detached 子进程，立即返回 `{status:"running"}` | I-1,I-8 |
| FR-02 | POST `/:id/generate` | `running` 状态下返回 409，spawn 调用次数为 0 | I-1 |
| FR-03 | POST `/:id/generate` | `needs_input` 状态下返回 409 | I-2 |
| FR-04 | POST `/internal/:id/callback` | token 匹配 + event=done → 状态→`done`，写 `result_json.zip_path` | I-3,I-5 |
| FR-05 | POST `/internal/:id/callback` | token 匹配 + event=needs_input → 状态→`needs_input`，写 `pending_question` | I-3 |
| FR-06 | POST `/internal/:id/callback` | token 匹配 + event=error → 状态→`error`，写 `result_json.error_message` | I-3 |
| FR-07 | POST `/internal/:id/callback` | token 不匹配或已使用 → 400，状态不变 | I-3,I-9 |
| FR-08 | POST `/:id/answer` | `needs_input` 状态下合法：回答写 messages_json，状态→`running`，重新 spawn detached | I-7 |
| FR-09 | POST `/:id/answer` | 非 `needs_input` 状态下返回 409 | I-7 |
| FR-10 | GET `/:id` | `running` 且 `updated_at > 2h` → 响应 `status=error` + 超时 error_message | I-4 |
| FR-11 | GET `/:id` | 响应新增 `pending_question`、`result_json` 字段 | — |
| FR-12 | 状态机 | `done` 为终态，任何 action 不改变状态 | I-5 |
| FR-13 | spawn | 子进程调用 `.unref()` 脱离父进程 | I-6 |
| FR-14 | DB migration | `skill_drafts` 表新增 `pending_question`/`result_json`/`callback_token` 字段 | — |
| FR-15 | 前端轮询 | `running`/`needs_input` 状态下每 8 秒轮询 GET `/:id` | I-10 |
| FR-16 | 前端-done | `result_json.zip_path` 渲染下载链接 | — |
| FR-17 | 前端-needs_input | 显示 `pending_question` + 答案输入框 + 提交按钮 | — |
| FR-18 | 前端-error | 显示 `result_json.error_message` + "重新开始"按钮 | I-8 |

---

## NFR

| # | 分类 | 要求 |
|---|------|------|
| N-01 | 可用性 | 子进程 detached + unref()，API 进程重启不中断正在跑的生成 |
| N-02 | 超时 | 软超时 2 小时（通过 GET `/:id` 延迟检测），不用心跳，不用硬 kill |
| N-03 | 安全 | `callback_token` 为 UUID，不对外暴露；内部回调路由不挂 staffGuard，靠 token 校验 |
| N-04 | 可观测 | 子进程 stdout/stderr 重定向到 `/tmp/skill-gen-<draft_id>.log`，失败时 error_message 包含日志尾 |
| N-05 | 并发 | 同一 draft 在 `running` 期间不允许并发第二个子进程（由 FR-02 互斥保证） |
| N-06 | DB | `updated_at` 必须在每次状态变更时同步更新，软超时判断依赖此字段精度 |
| N-07 | 兼容性 | 已存在的 `chatting`/`done`/`error` 状态记录（旧数据）通过 migration 默认值兼容，不需要数据修复 |
| N-08 | CI | 单测 + 路由合同测试全绿；windows_cloud E2E 轮询超时放宽到 30 秒 |

---

## 开发顺序（E2E-First，强制）

```
commit-1  写失败 E2E / 单测（Red）
           - apps/api/src/routes/__tests__/skill-drafts-longrun.test.ts
             覆盖 FR-01~FR-13 合同行为
           - apps/dashboard/e2e/skill-create-longrun.spec.ts
             覆盖轮询 / needs_input / done 下载 / error 重试

commit-2  DB migration（20260710_194200_skill_drafts_longrun.sql）
commit-3  状态机扩展（skillDraftStateMachine.ts 新增 running/needs_input 及迁移 generating→running）
commit-4  API 路由改造（skill-drafts.ts：generate 异步化 + answer + internal callback）
commit-5  前端改造（dashboard SkillCreate 组件：轮询 + needs_input UI + done 下载 + error 重试）
commit-6  让所有 Red 测试变 Green
```

---

## 验收标准（Final E2E）

- [ ] **E2E-1 Golden Path 异步**：真实点"开始吧" → 轮询 `GET /:id` → 最终 `status=done` → `result_json.zip_path` 文件存在（`node -e "require('fs').existsSync(path)"` 验证）
- [ ] **E2E-2 needs_input 循环**：构造一个会触发 `needs_input` 的生成任务 → 页面显示问题 → 员工提交答案 → 状态回 `running` → 最终 `done`
- [ ] **E2E-3 互斥锁**：`running` 时二次 POST `/:id/generate` 返回 409，mock spawn 断言调用次数为 0
- [ ] **E2E-4 callback token 校验**：过期/错误 token 的 callback 返回 400，draft 状态不变
- [ ] **E2E-5 软超时**：构造 `updated_at` 超过 2 小时的 `running` 记录 → `GET /:id` 返回 `status=error`
- [ ] **E2E-6 CI 全绿**：所有单测 + 路由合同测试 + Playwright E2E 通过

---

## 不做（本 sprint 明确排除）

- Brain task queue / worker 方案（已否决）
- 心跳机制（YAGNI，软超时兜底）
- 飞书/Bark 完成推送（已拍板不做）
- Brain task `6306e8cb`（验收报告页 6 维度重构）
- 技能库 drill-down 页面

---

## 文件影响清单

| 文件 | 操作 |
|------|------|
| `apps/api/db/migrations/20260710_194200_skill_drafts_longrun.sql` | 新建 |
| `apps/api/src/services/skillDraftStateMachine.ts` | 修改（新增 running/needs_input） |
| `apps/api/src/routes/skill-drafts.ts` | 修改（generate 异步化、answer、internal callback） |
| `apps/api/src/routes/__tests__/skill-drafts-longrun.test.ts` | 新建（commit-1 Red） |
| `apps/api/src/services/__tests__/skillDraftStateMachine.test.ts` | 修改（补 needs_input 路径） |
| `apps/dashboard/src/components/staff/SkillCreate.tsx` | 修改（轮询 + UI 状态） |
| `apps/dashboard/e2e/skill-create-longrun.spec.ts` | 新建（commit-1 Red） |

---

journey_type: internal_tooling
target_environment: windows_cloud
