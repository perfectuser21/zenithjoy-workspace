# Contract Draft：对话式创建 Skill — 后台长跑生成改造

sprint_dir: sprints/07101942-skill-create-longrun
task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
created_at: 2026-07-10
base_repo: zenithjoy

---

## 背景摘要

把 `/generate` 端点从同步等待改为后台长跑：
- 点"开始吧"后 API 立即返回，子进程 detached + unref() 后台跑
- 前端每 8 秒轮询 `GET /:id` 直到终态（done/error）
- 若 AI 需要员工决策则进入 `needs_input` 状态，员工提交答案后继续
- 软超时 2 小时（延迟检测，通过 GET 返回 error 状态）

---

## 状态机

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

---

## E2E 验收

### E2E-1：Golden Path 异步完成

**场景**：点"开始吧"后 API 立即返回，后台子进程跑完，前端轮询直到 done

**验收断言**：
1. `POST /:id/generate` 响应 `{status: "running"}`，HTTP 200，响应延迟 < 2 秒
2. 轮询 `GET /:id` 若干次后最终 `status === "done"`
3. `result_json.zip_path` 存在且文件在磁盘上真实存在：`node -e "const fs=require('fs'); const p=process.argv[1]; process.exit(fs.existsSync(p)?0:1)" <zip_path>`

### E2E-2：needs_input 循环

**场景**：AI 生成途中需要员工决策

**验收断言**：
1. 轮询到 `status === "needs_input"`
2. `pending_question` 字段非空
3. `POST /:id/answer` 提交答案后响应 `{status: "running"}`
4. 后续轮询最终 `status === "done"` 或再次 `needs_input`

### E2E-3：互斥锁（running 状态拒绝重复触发）

**场景**：`status=running` 时再次 POST generate

**验收断言**：
1. 第二次 `POST /:id/generate` 返回 HTTP 409
2. 通过 mock/spy 断言 `spawn` 调用次数为 0（无第二个子进程）
3. draft 状态保持 `running` 不变

### E2E-4：callback token 校验

**场景**：错误/过期 token 的子进程回调

**验收断言**：
1. `POST /internal/skill-drafts/:id/callback` 携带错误 token → HTTP 400
2. draft 状态不变（DB 查询确认）
3. 同一 token 第二次调用 → HTTP 400（token 单次绑定）

### E2E-5：软超时兜底

**场景**：`status=running` 的 draft `updated_at` 超过 2 小时

**验收断言**：
1. 直接操作 DB 将 `updated_at` 设为 `NOW() - INTERVAL '3 hours'`
2. `GET /:id` 响应 `status === "error"`
3. `result_json.error_message` 包含"超时"字样

### E2E-6：CI 全绿

**验收断言**：
1. `apps/api/src/routes/__tests__/skill-drafts-longrun.test.ts` 全部通过
2. `apps/dashboard/e2e/skill-create-longrun.spec.ts` Playwright 全部通过
3. GitHub Actions windows_cloud runner 无红

---

## Test Contract 表

| # | [BEHAVIOR] | 端点/模块 | 输入 | 期望输出 | 对应 FR/Invariant |
|---|-----------|-----------|------|----------|-----------------|
| B-01 | [BEHAVIOR] chatting→running 合法触发 | POST `/:id/generate` | draft.status=chatting | HTTP 200, body.status="running", spawn 调用 1 次, unref() 调用 | FR-01, I-1 |
| B-02 | [BEHAVIOR] error→running 重试合法 | POST `/:id/generate` | draft.status=error | HTTP 200, body.status="running", 新 callback_token 生成 | FR-01, I-8 |
| B-03 | [BEHAVIOR] running 状态互斥拒绝 | POST `/:id/generate` | draft.status=running | HTTP 409, spawn 调用次数=0 | FR-02, I-1 |
| B-04 | [BEHAVIOR] needs_input 状态拒绝 generate | POST `/:id/generate` | draft.status=needs_input | HTTP 409 | FR-03, I-2 |
| B-05 | [BEHAVIOR] callback done 终态 | POST `/internal/:id/callback` | token 匹配, event=done, zip_path | status→done, result_json.zip_path 写入 | FR-04, I-3 |
| B-06 | [BEHAVIOR] callback needs_input 暂停 | POST `/internal/:id/callback` | token 匹配, event=needs_input, question | status→needs_input, pending_question 写入 | FR-05, I-3 |
| B-07 | [BEHAVIOR] callback error 终态 | POST `/internal/:id/callback` | token 匹配, event=error, error_message | status→error, result_json.error_message 写入 | FR-06, I-3 |
| B-08 | [BEHAVIOR] callback token 不匹配拒绝 | POST `/internal/:id/callback` | token 错误 | HTTP 400, draft 状态不变 | FR-07, I-3 |
| B-09 | [BEHAVIOR] callback token 单次绑定 | POST `/internal/:id/callback` | token 已使用（同一 token 二次调用） | HTTP 400 | FR-07, I-9 |
| B-10 | [BEHAVIOR] answer 在 needs_input 合法 | POST `/:id/answer` | draft.status=needs_input | HTTP 200, status→running, messages_json 追加, 重新 spawn | FR-08, I-7 |
| B-11 | [BEHAVIOR] answer 在非 needs_input 拒绝 | POST `/:id/answer` | draft.status=running/chatting/done | HTTP 409 | FR-09, I-7 |
| B-12 | [BEHAVIOR] 软超时兜底 | GET `/:id` | draft.status=running, updated_at > 2h 前 | HTTP 200, body.status=error, result_json.error_message 含超时信息 | FR-10, I-4 |
| B-13 | [BEHAVIOR] GET 响应新字段 | GET `/:id` | 任意 draft | 响应含 pending_question、result_json 字段 | FR-11 |
| B-14 | [BEHAVIOR] done 终态封闭 | POST `/:id/generate` / callback / answer | draft.status=done | 任何 action 均不改变状态（generate→409, callback→400, answer→409） | FR-12, I-5 |
| B-15 | [BEHAVIOR] 子进程 detached unref | spawn 调用 | 任意合法 generate | 子进程调用 .unref()，父进程退出后子进程继续运行 | FR-13, I-6 |
| B-16 | [BEHAVIOR] DB migration 字段存在 | DB schema | 执行 migration | skill_drafts 表含 pending_question/result_json/callback_token 三个新字段 | FR-14 |
| B-17 | [BEHAVIOR] 前端轮询间隔 | Dashboard 前端 | status=running/needs_input | 每 8 秒发一次 GET /:id，不依赖 SSE | FR-15, I-10 |
| B-18 | [BEHAVIOR] 前端 done 显示下载链接 | Dashboard 前端 | status=done, result_json.zip_path | 页面渲染下载链接 | FR-16 |
| B-19 | [BEHAVIOR] 前端 needs_input 显示问题 | Dashboard 前端 | status=needs_input, pending_question | 页面显示问题文本 + 输入框 + 提交按钮 | FR-17 |
| B-20 | [BEHAVIOR] 前端 error 显示重试按钮 | Dashboard 前端 | status=error, result_json.error_message | 页面显示错误信息 + "重新开始"按钮 | FR-18 |

---

## 文件影响清单

| 文件 | 操作 |
|------|------|
| `apps/api/db/migrations/20260710_194200_skill_drafts_longrun.sql` | 新建 |
| `apps/api/src/services/skillDraftStateMachine.ts` | 修改 |
| `apps/api/src/routes/skill-drafts.ts` | 修改 |
| `apps/api/src/routes/__tests__/skill-drafts-longrun.test.ts` | 新建（commit-1 Red） |
| `apps/api/src/services/__tests__/skillDraftStateMachine.test.ts` | 修改 |
| `apps/dashboard/src/components/staff/SkillCreate.tsx` | 修改 |
| `apps/dashboard/e2e/skill-create-longrun.spec.ts` | 新建（commit-1 Red） |

---

## NFR 合同

| # | 分类 | 验收形式 |
|---|------|---------|
| N-01 | 可用性 | 集成测试：spawn + unref() 调用断言 |
| N-02 | 超时 | E2E-5：DB 直写 updated_at，GET 验证 error 响应 |
| N-03 | 安全 | 单测：内部回调路由无 staffGuard 中间件；token 校验单测 |
| N-04 | 可观测 | 单测：spawn 命令含 stdout/stderr redirect 到 /tmp/skill-gen-<id>.log |
| N-05 | 并发 | E2E-3：互斥锁断言 spawn 调用次数为 0 |
| N-06 | DB | 单测：状态变更后 updated_at 被更新 |
| N-07 | 兼容性 | migration 文件含默认值，旧数据查询 GET /:id 正常返回 |
| N-08 | CI | E2E-6：GitHub Actions windows_cloud 全绿 |
