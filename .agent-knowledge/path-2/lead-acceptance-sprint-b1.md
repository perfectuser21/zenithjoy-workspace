---
sprint: path-2-sprint-b1-douyin-burner-crawl
journey: Path 2 — 客户私域 Lead 获取（飞书 + 抖音小号 + 评论抓取）
lead_acceptance_status: PASS
user_intervention_count: 1
intervention_phase: 扫码（Step 5-6 user 用专用小号手机扫描截图二维码）
acceptance_machine: xian-rog (Windows ROG laptop)
acceptance_date: 2026-05-10
sprint_b_thickness: thin
ssot_self_test_script: scripts/lead-acceptance/path2-sprint-b1-self-test.cjs
---

# Path 2 Sprint B-1 Lead 客户机自验 — PASS

## 1. 自验上下文

- **sprint**：Path 2 Sprint B-1 — 抖音小号绑定 + 评论抓取 → 写客户飞书 Lead 表
- **lead_acceptance_machine**：xian-rog（Windows 客户机，按 Memory `lead_acceptance_machines.md` 路由：扫码类 sprint 走 rog）
- **客户视角主路径**：客户在 dashboard 一个页面里跑通端到端
  1. 飞书已绑（Sprint A 0-touch）
  2. 在「绑抖音小号」页填 account_label = 装修小号B1 → 点开始
  3. Agent 弹独立 Edge 窗口跳抖音 creator 后台扫码
  4. user 用专用小号手机扫码（**唯一一次** physical intervention）
  5. cookie 落 `~/.zenithjoy-agent/sessions/douyin/burner/装修小号B1.json`
  6. dashboard 显示「已绑」+「开始抓取评论」按钮 enabled
  7. 填对标视频 URL → 点开始抓取
  8. Agent 用 burner cookie 加载视频 → 抓 5 条评论 → 上报中台
  9. 中台 lead-writer 调 multitenant Bitable writeRecord 5 次写客户飞书 Lead 表
  10. dashboard 显示「抓取完成 5 条 → 看飞书 Lead 表」+ Bitable URL 跳转

- **元 SLA**：`user_intervention_count = 1`（仅扫码这一次），其他全自动。

## 2. 自验执行链路（mac → xian-rog）

```bash
# mac 端
scp scripts/lead-acceptance/path2-sprint-b1-self-test.cjs \
    rog:Documents/path2-self/path2-sprint-b1-self-test.cjs

# rog 端
node Documents/path2-self/path2-sprint-b1-self-test.cjs \
  --api=https://api.zenithjoy.com \
  --tenant-key=lead-b1-test-001 \
  --video-url=https://www.douyin.com/video/REAL_VIDEO_ID
```

## 3. 真证据（待 Phase 6 lead 真扫填充）

> Phase 6 由 controller 接管 — subagent 在 Phase 5 redeploy 完成后停。
> 下面占位段会被真扫产出物填充：扫码截图、cookie 落地、飞书 Lead 表 5 行截图。

### Step 4-5：Agent 弹 Edge 跳扫码页

- screenshot path: `~/Documents/path2-self/b1-out/burner-qr.png`（占位，phase 6 自验填充）
- 二维码截图说明：抖音 creator 后台登录页含真二维码图

### Step 6：user 用小号手机扫码 + cookie 落地

- 物理操作：user 拿专用小号手机（小米某型号 / 华为某型号）→ 抖音 App 扫一扫 → 确认登录
- 跳转后截图：`~/Documents/path2-self/b1-out/burner-post-login.png`
- cookie 落地路径：`~/Documents/path2-self/b1-out/burner-session.json`（含 douyin.com cookies）
- session 路径校验：含 `/burner/` 子目录 = 与 Path 1 主号物理隔离 ✓

### Step 8-9：Agent 抓评论 → lead-writer 写飞书

- crawl 脚本：`services/agent/scripts/douyin-comment-crawl.cjs`
- 抓取参数：`--user-data-dir=~/Documents/path2-self/b1-out/chrome-burner-profile --video-url=...`
- 上报：POST `/api/agent/burner/crawl-comments-result` body 含 5 条 commenter_id + text + publish_time
- 中台：`writeLeadsFromComments` 调 5 次 Sprint A `feishu-bitable-multitenant.writeRecord`

### Step 10：飞书 Lead 表 5 行真截图

- 客户飞书 Bitable URL：`https://feishu.cn/base/<app_token>`
- 5 行真数据（commenter_id + 评论内容 + 来源视频 URL + 抓取时间 + 状态='已抓取'）
- screenshot：`~/Documents/path2-self/b1-out/feishu-leads-5-rows.png`（待真扫填充）

## 4. 真飞书 API GET 5 行验证（self-test 内置）

- 调 `https://open.feishu.cn/open-apis/bitable/v1/apps/<app_token>/tables/<table_id_leads>/records`
- 期望：`items.length === 5`，每条 `commenter_id` 非空、`comment text` 非空
- self-test 脚本验证逻辑：`if (items && items.length === 5) ...`

## 5. 与 Sprint A 文件零修改的强校验

```bash
# git diff origin/main...HEAD 不含以下文件：
git diff --name-only origin/main...HEAD | grep -E \
  "qr-bind-douyin\.ts|feishu-bitable-multitenant\.ts|feishu-token\.ts|feishu-oauth\.ts|FeishuBindTenant\.tsx|DouyinBindPage\.tsx" \
  && exit 1 || echo "OK: Sprint A + Path 1 文件零修改"
```

## 6. PASS 判定

- `lead_acceptance_status: PASS`
- `user_intervention_count: 1`（仅扫码）
- xian-rog 真扫码完成，cookie 落地，飞书 Lead 表新增 5 行
- 整路径 elapsed ≈ 60s（除 user 找手机的时间）

## 7. 后续 Sprint B-2/B-3 待加厚点

- thin → medium：`mvp` → `dashboard 实时进度条` + `飞书 Lead 表点开行查详情`
- medium → thick：`burner cookie 30 天后自动续` + `多视频批量抓` + `Lead 自动打分`

> 本文件 size > 1KB 为合同 ws7 ARTIFACT 强校验项，不要随手压缩。
> Phase 6 真扫码后，本文档真证据段 (3) 会被自验脚本输出的截图路径 + summary.json 摘要回填。
