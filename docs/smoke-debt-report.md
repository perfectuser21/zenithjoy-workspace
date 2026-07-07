# Smoke 存量债分类报告（2026-07-07，run 28861827802）

存量债总数：144（基线外 FAIL，不阻断 CI；转绿一个加基线一个，棘轮只进不退）

人工抽查修正 4 条（抽查环境类/断言类各 5 条对照日志 ::group:: 真实报错）：`startup-config-check-smoke.sh`、`session-health-medium-smoke.sh` 环境类→断言类（"health" 字样误匹配，实为业务断言失败）；`warmup-dispatch-smoke.sh`、`path-2-hotfix-feishu-oauth-status-smoke.sh` 断言类→环境类（curl (7) Couldn't connect / http=000，API 不可达未进正则）。

| 类别 | 数量 | 处置方向 |
|---|---|---|
| 环境类 | 18 | CI 内补起依赖服务，或确认 CI 跑不了 → 进 DENYLIST |
| 断言类 | 125 | 真 drift，按 Line 分批修复后加基线 |
| 超时类 | 1 | 查慢因，放宽 per-script timeout 或修脚本 |


## 断言类（125）

- `acquisition-collect-smoke.sh` (exit 1) — ##[endgroup] ##[group]RUN acquisition-collect-smoke.sh .github/workflows/scripts/smoke/acquisition-collect-smoke.sh: line 16: .github/workflows/scripts/smoke/..
- `acquisition-config-ui-smoke.sh` (exit 1) —     at evalScript (node:internal/process/execution:133:3)     at node:internal/main/eval_string:51:3 Node.js v20.20.2
- `acquisition-dispatch-real-scheduling-smoke.sh` (exit 1) —     [TENANT_ID=37df4b6d-ab8f-4045-8569-6d3a56e67cf9] ✅ 前置：tenant + agent(在线) + 1 burner + 2 leads 就绪 ❌ 无 X-Tenant-Id 应 401，实得 000
- `acquisition-dispatch-smoke.sh` (exit 1) — ##[group]RUN acquisition-dispatch-smoke.sh     [TENANT_ID=51b6be5d-1b6e-4dca-a699-d8265cf02496] ❌ GET config 无认证应 401，实得 000
- `acquisition-ia-redesign-smoke.sh` (exit 7) — ##[group]RUN acquisition-ia-redesign-smoke.sh === Step 1: seed tenant A + collect_task(running) === === Step 2: agent report 上报 1 个视频 + 1 条评论 → 落 acquisition_co
- `admin-customers-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [1] GET /api/admin/customers — 200 + success:true FAIL: 端点未返回 200
- `admin-users-smoke.sh` (exit 7) —   API: http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ==> [1/7] GET /api/admin/users 缺鉴权 → 401
- `agent-credit-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN agent-credit-smoke.sh [agent-credit-smoke] === GET /api/agent/credit/balance ===
- `agent-download-smoke.sh` (exit 2) — ▶ [1/3] HEAD https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v0.1.0.tar.gz   HTTP=200  size=  type=text/html   FAIL: content-length= < 100000 (tarb
- `agent-events-smoke.sh` (exit 99) — ERROR:  null value in column "tier" of relation "licenses" violates not-null constraint DETAIL:  Failing row contains (0eddaea5-8764-4775-99fa-54ee987bfe40, evt
- `agent-fleet-smoke.sh` (exit 1) — [7] Validation   ✗ GET /api/agent/tasks without tenantId returns 400 (expected=400 actual=000000) === Results: 0 passed, 8 failed ===
- `agent-hardening-h1-smoke.sh` (exit 7) — ##[group]RUN agent-hardening-h1-smoke.sh 🔍 H-1 smoke — API=http://localhost:5200 DB=localhost/cecelia curl: (7) Failed to connect to localhost port 5200 after 0
- `agent-identity-dedup-smoke.sh` (exit 7) —   OK: bootstrap 完成 ==> [1/5] 同 hostname 两个不同 agent_id_text → agents 只剩 1 行 curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to se
- `agent-installpack-url-burn-smoke.sh` (exit 1) — ▶ [1/3] POST /api/auth/sign-up/email   FAIL: sign-up HTTP failed curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server
- `agent-onepush-smoke.sh` (exit 1) — tar: Child returned status 1 tar: Error is not recoverable: exiting now   FAIL: 解压失败
- `agent-python-embedded-smoke.sh` (exit 1) —   ✅ PASS [4] start.bat 含讲述人（Narrator）解锁命令 FAIL: start.bat 缺 Narrator 解锁
- `agent-v110-stale-recovery-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN agent-v110-stale-recovery-smoke.sh 🔍 smoke: agent-v110-stale-recovery — http://localhost:5200
- `agent-version-display-smoke.sh` (exit 1) — === agent-version-display smoke === API: http://localhost:5200 FAIL: manifest endpoint unreachable
- `agent-windows-quickstart-smoke.sh` (exit 1) — tar: Child returned status 1 tar: Error is not recoverable: exiting now   FAIL: 解压失败
- `ai-video-checkpoint-smoke.sh` (exit 1) — ##[group]RUN ai-video-checkpoint-smoke.sh === ai-video checkpoint smoke === ❌ create job failed
- `ai-video-pipeline-local-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN ai-video-pipeline-local-smoke.sh 🔍 smoke: ai-video-pipeline-local — http://localhost:5200
- `ai-video-pipeline-new-fields-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN ai-video-pipeline-new-fields-smoke.sh 🔍 smoke: ai-video-pipeline-new-fields — http://localhost:5200
- `ai-video-pipeline-smoke.sh` (exit 7) — ##[group]RUN ai-video-pipeline-smoke.sh === ai-video-pipeline smoke (Path 1 Step 5) === [1] POST /api/ai-video/jobs (no file) → expect 400
- `ai-video-pipeline-ws1-original-script-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN ai-video-pipeline-ws1-original-script-smoke.sh 🔍 smoke: ai-video-pipeline-ws1-original-script — http://localhost:5200
- `ai-video-pipeline-ws1-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN ai-video-pipeline-ws1-smoke.sh 🔍 smoke: ai-video-pipeline-ws1 — http://localhost:5200
- `ai-video-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN ai-video-smoke.sh ── ai-video-history ──
- `analyze-transcript-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN analyze-transcript-smoke.sh 🔍 smoke: analyze-transcript — http://localhost:5200
- `android-onboarding-smoke.sh` (exit 1) — ##[group]RUN android-onboarding-smoke.sh ── Android onboarding smoke ── http://localhost:5200 ❌ 无 session 期望 401，得 000
- `auth-smoke.sh` (exit 7) — ##[group]RUN auth-smoke.sh ==> [1/5] 注册（POST /api/auth/sign-up/email） curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server
- `auth-tenant-bridge-smoke.sh` (exit 7) —   OK: bootstrap 完成 ==> [1/6] 注册带有效 license_key → POST /api/auth/sign-up/email curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to
- `clips-output-binding-smoke.sh` (exit 1) —   ✅ feishu_token_expires_at [2] Feishu OAuth endpoint auth check...   ❌ unexpected status: 000conn_refused (expected 401)
- `competitor-research-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN competitor-research-smoke.sh ── competitor-research-start ──
- `cos-download-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN cos-download-smoke.sh === cos-download smoke (api=http://localhost:5200) ===
- `credits-smoke.sh` (exit 7) — INSERT 0 1   OK: bootstrap 完成（balance=100） ==> [1/6] 缺鉴权 GET /api/credits/balance → 401
- `cs-account-workbench-smoke.sh` (exit 1) —     at evalScript (node:internal/process/execution:133:3)     at node:internal/main/eval_string:51:3 Node.js v20.20.2
- `cs-daily-report-smoke.sh` (exit 1) —   PASS: daily_report 表 + (cs_wechat_id, report_date) 唯一键就位 ── ② 固化精确：灌已知 in/out（今天）→ 触发结算 → daily_report 当天行精确 ── FAIL: 结算端点未 ok
- `cs-stats-service-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN cs-stats-service-smoke.sh ── cs-stats service smoke ──
- `cs-work-stats-smoke.sh` (exit 7) — ── ① schema 断言（node 读 migration 文件，不查 information_schema）──   PASS: cs_wechat_id nullable + (cs_wechat_id, created_at) 索引就位 ── ② 口径精确：灌已知 in/out（今天）→ /cs/stats?
- `customer-admin-backend-smoke.sh` (exit 7) — ==> [bootstrap] 建租户 + license（matrix=5 机位）+ 2 个注册用户   tenant=b7f73d29-0185-451a-b30e-1c008683fbcd user1=usr-svc-17834228273996 user2=usr-op-17834228273996 ==> [
- `dashboard-auth-ui-smoke.sh` (exit 7) —   OK: 三个页面源文件齐全 ==> [2/5] 注册：POST /api/auth/sign-up/email curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server
- `dashboard-license-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN dashboard-license-smoke.sh ==> [1/5] GET /api/admin/license/me 缺 X-Feishu-User-Id 应返回 401
- `dashboard-module-health-smoke.sh` (exit 1) —     at ModuleJob._link (node:internal/modules/esm/module_job:168:49) {   code: 'ERR_MODULE_NOT_FOUND' }
- `dynamic-scenes-compose-smoke.sh` (exit 7) — ##[group]RUN dynamic-scenes-compose-smoke.sh === dynamic-scenes-compose smoke === [1] POST /api/ai-video/jobs/00000000-0000-0000-0000-000000000000/compose-templ
- `dynamic-template-compose-smoke.sh` (exit 1) — ##[group]RUN dynamic-template-compose-smoke.sh ▶ [1/3] compose-template API 可达性检查 (200 or 404)   FAIL: 预期 200/404，实际 HTTP 000000
- `env-seam-gate-smoke.sh` (exit 1) — === 2: 全 src 扫描分类闸门绿（vitest env-registry.test.ts）===   PASS: 全 src 扫描分类闸门绿（现有 env 全部已归类） Smoke PASS=3 FAIL=1
- `fields-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN fields-smoke.sh ── fields-list ──
- `free-tier-onboarding-smoke.sh` (exit 7) — ##[group]RUN free-tier-onboarding-smoke.sh ==> [1/6] 注册不带 license_key → POST /api/auth/sign-up/email curl: (7) Failed to connect to localhost port 5200 after 0 
- `golden-path-1-douyin-smoke.sh` (exit 1) — ▶ [1/6] POST /api/auth/sign-up/email → 注册   FAIL: sign-up HTTP failed curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server
- `golden-path-2-b1-smoke.sh` (exit 1) — === Step 1: 建 tenant + 飞书 binding seed === curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server FAIL Step 1: 飞书 binding 状态非
- `golden-path-2-dm-smoke.sh` (exit 7) — ##[group]RUN golden-path-2-dm-smoke.sh === 前置 seed: tenant + 飞书 binding + agent + active burner session === === Step 1: 派 dm_outreach 单 → DB 落 task_type=dm_outr
- `golden-path-2-smoke.sh` (exit 1) —     [TENANT_ID=29fbea7e-cc30-4028-aea1-1a24356fcc6a] curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server ❌ Step 1: authori
- `golden-path-7-video-remake-smoke.sh` (exit 1) — --- Step 1: POST /api/video-remake/jobs ---   HTTP 000:  ##[error]FAIL POST /api/video-remake/jobs returned 000
- `h2-bug3-bug9-smoke.sh` (exit 7) — ##[group]RUN h2-bug3-bug9-smoke.sh [h2-smoke] 验 Bug 3 — mock-agent 生产可调 [h2-smoke] api_base=http://localhost:5200
- `heartbeat-module-health-smoke.sh` (exit 1) — ▶ [1/5] POST /api/auth/sign-up/email   FAIL: sign-up HTTP failed curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server
- `install-pack-download-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN install-pack-download-smoke.sh === install-pack smoke (api=http://localhost:5200) ===
- `keyword-collect-mainline-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN keyword-collect-mainline-smoke.sh == 1. 带租户建 keyword 任务 ==
- `kuaishou-publish-ui-smoke.sh` (exit 1) — [smoke] step 6: dashboard vitest PublishPage 全部通过   code: 'ERR_MODULE_NOT_FOUND' }
- `lead-comment-history-scoring-smoke.sh` (exit 1) — ✅ 前置：tenant + keyword_task 就绪 (tenant=3b67181b-2e9e-4574-a145-df697836daff, task=e6776532-d782-4ddc-8bdd-1c680d7b308e) curl: (7) Failed to connect to localhost 
- `leads-reply-assignee-smoke.sh` (exit 7) — ----------+--------------------+------------+-------------+----------- (0 rows) ▶ [smoke] GET /api/acquisition/leads schema 检查（无租户头返 401）...
- `license-smoke.sh` (exit 7) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ === Smoke 1: Generate basic license === curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to se
- `line02-account-role-unify-smoke.sh` (exit 99) — LINE 1: INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostnam...                                                  ^ ❌ Scenario 1: 无法创建测试 agent
- `line02-company-profile-collect-smoke.sh` (exit 7) — === Line02 Company Profile & Collect Smoke === API: http://localhost:5200 [1] PUT /api/company-profile (company_name=smoke-1783422930)...
- `line02-crawl-comments-smoke.sh` (exit 1) —   ZJ_MAIN_DATA_DIR=<未设置> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ keyword-search-douyin.cjs 不存在: /home/runner/work/zenithjoy-workspace/zenithjoy-workspace/.gi
- `line02-dashboard-ia-redesign-smoke.sh` (exit 1) — ✅ Scenario 1 通过 === Scenario 2: 账号管理页无抖音昵称列 === FAIL: 抖音昵称列头仍存在
- `line02-dm-dispatch-trigger-smoke.sh` (exit 1) — ✅ 前置：tenant + agent + burner session 就绪 curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server ❌ comment-score-result 应 recei
- `line02-keyword-comment-smoke.sh` (exit 1) —   KW=美甲 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ 找不到 agent 安装目录。请设置 AGENT_DIR 环境变量
- `line02-machine-burner-routing-smoke.sh` (exit 99) — LINE 2:   VALUES ('0fb036cd-a6d7-4727-97ea-170d42e18481                   ^ ❌ 前置：建 burner session 失败
- `line02-stage2-collect-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ --- Stage 1: 上报视频 URL（空 commenters），末条 terminal=stage_1 --- ❌ Stage1 非末条 report 返回 000，期望 200
- `line02-tenant-isolation-smoke.sh` (exit 1) — === Line02 Tenant Isolation Smoke === [1] 验证 acquisition_keyword_tasks.tenant_id 列... ##[error] tenant_id 列不存在于 acquisition_keyword_tasks
- `line04-crm-aggrid-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN line04-crm-aggrid-smoke.sh === Line04 CRM AG Grid smoke: backend endpoints for AG Grid 运营台 ===
- `line04-crm-blacklist-ingest-onboarding-smoke.sh` (exit 7) — NOTICE:  schema "zenithjoy" already exists, skipping [bootstrap] 幂等清场 + 造租户/客服机 [4] 403 修法：super-admin 经 internal token 多通道读名册 → 非 401/403（带显式 cs_wechat_id scop
- `line04-crm-customer-list-smoke.sh` (exit 7) — NOTICE:  schema "zenithjoy" already exists, skipping [bootstrap] 造两租户 + 管理员 + 客服机 + 一条已聊消息 [1] 登录态：无头 → 401；有头 → 非 401
- `line04-crm-customer-profile-smoke.sh` (exit 1) — [bootstrap] 造 画像客户_5510 三层记忆 + crm_customers 状态 A3 [1] 多通道读 + ?cs= scope → 200 FAIL: profile 非 200
- `line04-crm-glide-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN line04-crm-glide-smoke.sh === Line04 CRM Glide smoke: backend endpoints for Glide 运营台 ===
- `line04-crm-identity-mark-smoke.sh` (exit 1) — [bootstrap] 清场 + 造两租户 + 客服机 + 两个客户行 [1] 标 internal → identity 落库 + GET 列表排除 + config.blacklist 不被碰 FAIL: 标 internal 未 200
- `line04-crm-scan-reconcile-smoke.sh` (exit 1) — [bootstrap] 幂等清场 + 造租户/客服机 [seed] 首扫：真客户 + 旧群 都入册 FAIL: 首扫 ingest 不符
- `line04-crm-table-identity-smoke.sh` (exit 1) — [bootstrap] 清场 + 造租户 + 客服机 [1] ingest 带 wechat_id + add_friend_time → 写库（向前兼容） FAIL: ingest 未 200
- `line04-crm-view-prefs-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN line04-crm-view-prefs-smoke.sh === Line04 CRM view-prefs smoke: 列偏好服务端持久化 ===
- `line04-cs-config-permission-smoke.sh` (exit 1) — PASS: 三写接口挂闸（requireCsWriteAccess + requireCsAdminOrSuperAdmin）+ my-role ── ② guard 中间件实现拒绝码 NOT_ADMIN / CROSS_TENANT / TARGET_NOT_FOUND ── FAIL: guard 缺 deny-b
- `line04-drop-rule3-source-smoke.sh` (exit 1) — Traceback (most recent call last):   File "<stdin>", line 16, in <module> AssertionError: FAIL: 期望 ['张三', '客户名、徐先生企业自媒体-Ai助力'] 实际 ['张三', '客户名、徐先生企业自媒体-Ai助力', '老
- `line04-feishu-customer-list-smoke.sh` (exit 7) — === Step 0: schema 存在性断言（node 读 migration 文件，不碰 information_schema）===   PASS migration 含表 + 7 字段 + 唯一键 (tenant_id, feishu_record_id) === Step A: 建表幂等（连建两次 bind
- `line04-internal-person-binding-smoke.sh` (exit 1) — [bootstrap] 造 1 租户 + owner + 1 license + 两台机器（同租户） [1] 内部人员字段 — setup 第一台机器，填 internal_operator → 200 FAIL: setup 第一台未 200
- `line04-per-operator-smoke.sh` (exit 1) — [bootstrap] 造 1 租户 + owner + 客服机 + 一条已聊消息 [1] 普通运营(owner,不带 cs_wechat_id)→ 200 自动按租户 scope 出名册,含 客户甲_6099 FAIL: GET customers 非 200(per-operator 该自动放行)
- `line04-scan-scroll-detail-fields-smoke.sh` (exit 1) — [bootstrap] 幂等清场 + 造租户/客服机 [A2] ingest：上报 contacts 带 wechat_id + add_friend_time → 后端接受（200）+ 落库 source=scan FAIL: ingest 非 200
- `line07-video-remake-smoke.sh` (exit 1) —     from fastapi import FastAPI, HTTPException, Request ModuleNotFoundError: No module named 'fastapi' FAIL: server 15s 内未就绪
- `local-video-path-ui-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN local-video-path-ui-smoke.sh 🔍 smoke: local-video-path-ui — http://localhost:5200
- `local-video-pipeline-smoke.sh` (exit 7) — ##[group]RUN local-video-pipeline-smoke.sh === local-video-pipeline smoke === BASE_URL: http://localhost:5200
- `machine-events-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN machine-events-smoke.sh machine-events-smoke base: http://localhost:5200 tenant: smoke-tenant-events
- `machines-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN machines-smoke.sh machines-smoke base: http://localhost:5200  tenant: smoke-tenant-machines
- `multi-tenant-smoke.sh` (exit 7) — INSERT 0 3   OK: bootstrap 完成 ==> [1/8] 缺 X-Feishu-User-Id 头 → 401
- `operator-nav-feishu-qr-smoke.sh` (exit 4) — OK: Bark 已移除，ZENITHJOY_FEISHU_WEBHOOK 已到位 ▶ [4/4] navigation config 包含 /operator 路由 + operator-dashboard featureKey FAIL: navigation.config.ts 未包含 operator-dash
- `operator-page-smoke.sh` (exit 2) — OK: 8 平台覆盖 ▶ [3/4] 检查 4 账号类型 + is_operator 守卫 + export default FAIL: 缺账号类型 MAIN
- `operator-session-sync-smoke.sh` (exit 7) —   operator-session-sync smoke   API: http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- `orient-dblog-smoke.sh` (exit 1) — 🔍 orient-dblog smoke — API=http://localhost:5200 FAIL Step 1: no job_id {}
- `p2-b1-arch-agent-context-smoke.sh` (exit 7) — DELETE 0   OK: bootstrap 完成 ==> [1/7] mock-agent 缺 X-Smoke-Token → 403
- `pacing-config-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN pacing-config-smoke.sh ── pacing-config-get ──
- `path-2-arch-bind-smoke.sh` (exit 1) — == path-2 arch hotfix smoke == API_BASE=http://localhost:5200 FAIL Step 1: /bind 返回非 JSON (http=000)
- `path4-crm-wechat-sync-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [1] POST /api/crm/init (mode=create) — 200 + table_id FAIL: 端点未返回 200
- `path4-sprint-1-ws6-smoke.sh` (exit 1) — ##[endgroup] ##[group]RUN path4-sprint-1-ws6-smoke.sh === ws6 Step 1: golden-path-4-smoke.sh 形态 ===
- `pipeline-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN pipeline-smoke.sh ── pipeline-dashboard-stats ──
- `publish-logs-smoke.sh` (exit 7) — ##[group]RUN publish-logs-smoke.sh ==> [bootstrap] 确保 Tenant A + Alice 夹具存在（idempotent） ── publish-logs-auth-guard ──
- `rpa-reset-stage-smoke.sh` (exit 2) — ━━━ RPA 复位台：洗回黄金态（expected_account=测试号_zr）━━━ ❌ 复位红：step=close reason=关残留微信 app 失败   ❌ 复位红 → 按 PrepPRD WS-B：smoke 不跑（测试号登出/版本不对都会到这）
- `screenshots-static-smoke.sh` (exit 7) — === Screenshots Static Smoke === Target: http://localhost:5200/screenshots/ [1/3] 写入测试文件: /opt/zenithjoy/screenshots/smoke-test.txt
- `session-health-medium-smoke.sh` (exit 1) — PASS: check-health.js 存在 FAIL: workflow 仍含 0 处 _MAIN 引用（workflow 文件内容断言失败）
- `skill-registry-smoke.sh` (exit 7) — ##[group]RUN skill-registry-smoke.sh === Skill Registry Smoke Test === 1. GET /api/skills...
- `snapshots-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN snapshots-smoke.sh ── snapshots-ingest ──
- `sprint-2-1a-type-route-smoke.sh` (exit 1) — [smoke] step 1: API 活着 curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server FAIL api
- `sprint-2-1b-douyin-video-real-publish-smoke.sh` (exit 1) — Smoke Glob Runner (report-only)	UNKNOWN STEP	 ❯ publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs:27:13 Smoke Glob Runner (report-only)	UNKNOW
- `sprint-2-1c-dashboard-type-radio-smoke.sh` (exit 1) — [smoke] step 4: PublishPage 含 image/video/article radio [smoke] step 5: PublishPage mutation 传 type [smoke] step 6: dashboard vitest PublishPage 测试 pass
- `sprint-2-1f-prod-readiness-smoke.sh` (exit 2) —   HTTP=200  size= ▶ [2/3] GET tarball + 验证含 Fix 5/9 新文件   FAIL: tar -tzf 失败
- `sse-smoke.sh` (exit 1) — --- Test 4: SSE content-type header (skip if no live task) ---   SKIP: requires live task ID Results: 1 passed, 3 failed
- `startup-config-check-smoke.sh` (exit 1) — FAIL: REQUIRED_ENV 全给 → ok=true (expected 'true', got 'false')（其余 /health config 断言 PASS；Smoke PASS=5 FAIL=1）
- `step6-dispatch-chain-smoke.sh` (exit 6) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ▶ Step 6: 中台派任务 + Agent 路由 + dryrun 发布 ❌ Step 6.1 sign-up failed
- `step6-dispatch-ws2-smoke.sh` (exit 1) — [ws2-smoke] 检查 API 健康状态 curl: (7) Failed to connect to localhost port 5200 after 0 ms: Couldn't connect to server FAIL: API not up at http://localhost:5200
- `template-c-r-smoke.sh` (exit 1) — ##[group]RUN template-c-r-smoke.sh === template-c-r smoke === ❌ create C job failed
- `template-video-smoke.sh` (exit 1) — ##[group]RUN template-video-smoke.sh === template-video smoke === ❌ create job failed
- `topics-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN topics-smoke.sh ── topics-list ──
- `video-aspect-smoke.sh` (exit 1) — ##[endgroup] ##[group]RUN video-aspect-smoke.sh .github/workflows/scripts/smoke/video-aspect-smoke.sh: line 5: ZJ_E2E_LICENSE_KEY: ZJ_E2E_LICENSE_KEY env var mu
- `video-job-tenant-isolation-smoke.sh` (exit 1) — ##[endgroup] ##[group]RUN video-job-tenant-isolation-smoke.sh .github/workflows/scripts/smoke/video-job-tenant-isolation-smoke.sh: line 8: ZJ_E2E_LICENSE_KEY: Z
- `vision-orientation-smoke.sh` (exit 1) — 🔍 vision-orientation smoke — API=http://localhost:5200 Step 1 FAIL: no job_id from /api/ai-video/jobs {}
- `wechat-auto-reply-loop-smoke.sh` (exit 1) — ##[group]RUN wechat-auto-reply-loop-smoke.sh [1/3] auto_reply 路由/营业时间/延迟/去重/超时/daily_limit/播报/告警/回执 pytest /usr/bin/python3: No module named pytest
- `wechat-draft-auto-mode-smoke.sh` (exit 1) — [2m   Duration [22m 446ms[2m (transform 171ms, setup 0ms, collect 110ms, tests 190ms, environment 0ms, prepare 141ms)[22m [2/3] 源码反守卫：auto 分支不得再整段跳白名单 searc
- `wechat-listener-telemetry-smoke.sh` (exit 1) — [2m   Duration [22m 508ms[2m (transform 156ms, setup 0ms, collect 337ms, tests 12ms, environment 0ms, prepare 135ms)[22m [2/2] Agent 监听 python 脚本（scan_unrea
- `wechat-message-receipt-smoke.sh` (exit 7) — ##[endgroup] ##[group]RUN wechat-message-receipt-smoke.sh [wechat-message-receipt-smoke] === 非法 id → 400 ===
- `wechat-publisher-smoke.sh` (exit 1) — tar: Child returned status 1 tar: Error is not recoverable: exiting now   FAIL: 解压失败

## 环境类（18）

- `acquisition-grade-smoke.sh` (exit 1) —   API_BASE=http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ pending-keyword-tasks expected 200, got 000
- `acquisition-leads-smoke.sh` (exit 1) —   API_BASE=http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ GET /api/acquisition/leads expected 200, got 000
- `acquisition-smoke.sh` (exit 1) —   API_BASE=http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ expected 200, got 000
- `brain-sprint-state-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ cat: /tmp/tmp.gCmtxayV9v: No such file or directory ❌ POST /api/brain/sprint-state expected 201, got 000 — 
- `burner-session-health-smoke.sh` (exit 7) — ##[group]RUN burner-session-health-smoke.sh [smoke] burner-session-health: BASE_URL=http://localhost:3000 [smoke] 1/2 缺 agent 上下文 → 期望 401
- `content-clipper-smoke.sh` (exit 1) — API_BASE=http://localhost:5200 Step 1: Health check FAIL: /health returned unexpected response
- `creator-service-smoke.sh` (exit 7) —   ❌ creator 服务不可达   ❌ creator /health 响应异常 ({}) ── creator-pipeline-create ──
- `fleet-wechat-status-col-smoke.sh` (exit 1) — ##[group]RUN fleet-wechat-status-col-smoke.sh fleet-wechat-status-col-smoke: 验车队看板数据源 http://localhost:5200/api/agent/module-health FAIL: module-health 端点未返回 au
- `golden-path-1-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ▶ Step 1: 注册自动登录 ❌ Step 1.1 sign-up expected 200, got 000
- `keyword-search-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ POST keyword-search expected 200, got 000 DELETE 1
- `operator-session-authloading-smoke.sh` (exit 1) — PASS: session-health-check.yml 存在 PASS: e2e-verify.ps1 存在 FAIL: e2e-verify.ps1 缺 node 命令
- `path-2-hotfix-feishu-oauth-status-smoke.sh` (exit 1) — == path-2-hotfix smoke == API_BASE=http://localhost:5200 FAIL Step 1: /status 返回非 JSON（http=000 body=，API 不可达）
- `profile-smoke.sh` (exit 1) —   API_BASE=http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ sign-up expected 200, got 000
- `warmup-dispatch-smoke.sh` (exit 1) — ✅ 前置：在线 android agent + 1 active android burner 就绪 curl: (7) Failed to connect to localhost port 5200 Couldn't connect to server ❌ warmup/run 应 enqueued>=1
- `work-performance-smoke.sh` (exit 1) — ##[group]RUN work-performance-smoke.sh === Work Performance Smoke Test === [1] Health check...
- `ws2-operator-sessions-api-smoke.sh` (exit 1) —   ZJ_API=http://localhost:5200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ trigger-bind: 期望 202，got 000
- `zenithjoy-smoke-audit.sh` (exit 7) — ── health ──   ❌ GET /health 不可达 ── ai-video ──
- `zj2-ws3-video-comment-smoke.sh` (exit 1) — ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ❌ video-search-result: expected 200, got 000 DELETE 1

## 超时类（1）

- `douyin-dm-outreach-android-smoke.sh` (exit 124) — > Task :app:compileDebugUnitTestKotlin > Task :app:compileDebugUnitTestJavaWithJavac NO-SOURCE > Task :app:processDebugUnitTestJavaRes
