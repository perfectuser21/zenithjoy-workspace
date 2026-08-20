---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
gp_anchor: line11/structured_workbench#step1
---
# Contract DoD — Sprint: 员工知识中枢 路③ 结构化工作台 · Sprint A（底座与三道门）

**范围**: G0 会话鉴权闸 + A2 静态守卫 / G1 新字段元数据表隔离 + 旧 `/api/fields` J7 四段处置 / G2 `pg_dump` 备份与恢复演练 / JSONB 五表存储底座 / S1 建表最小闭环（模板 · 8 类字段 · 表级可见性 · 软删回收站）/ A35① 前向兼容锚 / A33 独立 windows workflow 接线
**不在范围**: S2 录数据（Sprint B）、S3 视图看板（Sprint C）、S4 关联（Sprint D）；不删端点/表/service
**大小**: L

> 全部 `manual:` 命令的工作目录 = repo 根。段2/段3 需 `E2E_DATABASE_URL`（或 `DATABASE_URL`）；未设时脚本自身报错退出，**不落默认库**。
> `--static-only` 与各 `--aN-only` 分段可独立跑，evaluator 无需每条都拉起全链。

## ARTIFACT 条目

- [ ] [ARTIFACT] `workbenchAuthGuard` 中间件存在，且身份只来自服务端会话（零身份头名字面量）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/workbench-auth.ts','utf8');if(!/workbenchAuthGuard/.test(c))process.exit(1);if(/X-Tenant-Id|X-User-Email|X-Feishu-User-Id|X-Bypass-Tenant|tenantContextOptional|selfHealOwnerMember|staffGuard/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ 五表 migration 存在，五张表逐个 `org_id NOT NULL`，DDL 幂等（`IF NOT EXISTS`）
  Test: node -e "const fs=require('fs');const d='apps/api/db/migrations';const f=fs.readdirSync(d).find(n=>/structured_workbench|knowledge_db/.test(n)&&n.endsWith('.sql'));if(!f)process.exit(1);const c=fs.readFileSync(d+'/'+f,'utf8');for(const t of ['db_tables','db_fields','db_rows','db_view_prefs','db_audit']){if(!new RegExp('CREATE TABLE IF NOT EXISTS zenithjoy\\\\.'+t).test(c))process.exit(1)}if((c.match(/org_id\s+uuid\s+NOT NULL/gi)||[]).length<5)process.exit(1)"

- [ ] [ARTIFACT] A35① 排除清单文件存在、可被 Node 解析，导出常量数组逐字含五个物理表名
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/knowledge/retrieval-exclusions.ts','utf8');for(const t of ['db_tables','db_fields','db_rows','db_view_prefs','db_audit']){if(!c.includes(t))process.exit(1)}if(!/export const .*=\s*\[/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ smoke 脚本存在且已进 `smoke-baseline.txt`（否则 nightly 不跑 = 死了没人知道）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('.github/workflows/scripts/smoke/structured-workbench-smoke.sh'))process.exit(1);if(!fs.readFileSync('.github/workflows/scripts/smoke-baseline.txt','utf8').includes('structured-workbench-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] 独立 E2E workflow 存在：`on:` 含 `pull_request`，`paths` 含路③ spec 与源码
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-knowledge-hub-path3.yml','utf8');if(!/^\s{2}pull_request:/m.test(c))process.exit(1);if(!/windows-latest/.test(c))process.exit(1);if(!/structured-workbench\.spec\.ts/.test(c))process.exit(1)"

- [ ] [ARTIFACT] G2 备份 workflow 存在且 `on:` 含 `schedule`（持久载体，非一次性手跑）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/db-backup.yml','utf8');if(!/^\s{2}schedule:/m.test(c))process.exit(1);if(!/pg_dump/.test(c))process.exit(1);if(!/restore-drill\.sh/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路③ 前端不走 `adminFetch`（那条通道拼两个明文身份头，是既有 16 端点的凭据，两路不得互串）
  Test: node -e "const fs=require('fs');const p='apps/staff-hub/src/pages';const hit=fs.readdirSync(p).filter(n=>/Workbench/.test(n)).map(n=>fs.readFileSync(p+'/'+n,'utf8')).filter(c=>/adminFetch/.test(c));if(hit.length)process.exit(1)"

- [ ] [ARTIFACT] Sprint B/C 记账三项已留痕（AG Grid 32.2.1 / dnd-kit / 5000 行上限，本刀只记账不引入）
  Test: node -e "const c=require('fs').readFileSync('sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/accounting.md','utf8');for(const k of ['32.2.1','dnd-kit','5000'])if(!c.includes(k))process.exit(1)"

## BEHAVIOR 条目

> 对应 Golden Path Step1–Step10。每条都可回答「这是 Golden Path 哪一步的用户可观察输出」，且对应代码一行没写时必然 FAIL。

### Step1 — 空工作台模板（A7）

- [ ] [BEHAVIOR] 模板端点返回 ≥2 个开箱模板，且一键建表后表结构与模板声明逐字一致
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a7-only
  期望: exit 0，输出含 `A7 通过`

### Step2 — 建表与 8 类字段（A6 前半 / A10）

- [ ] [BEHAVIOR] 建表返 201，`org_id` 取自会话而非请求体，八类字段各一落 `db_fields`（带 5 分钟时间窗防历史行冒充）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a6-only
  期望: exit 0，输出含 `A6 通过`

- [ ] [BEHAVIOR] 建表全程零运行时 DDL：`information_schema.tables WHERE table_schema='zenithjoy'` 建表前后集合全等且等于 migration 声明集合
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a10-only
  期望: exit 0，输出含 `A10 通过`

### Step3 — G0 命门：伪造头无效 + 正向对照（A1 / A3）

- [ ] [BEHAVIOR] 持 B 企业会话伪造 `X-Tenant-Id`/`body.tenant_id` 指向 A 企业打 4 个写端点全部被拒，且 A 企业行前后 md5 全等
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a1-a3-only
  期望: exit 0，输出含 `A1 通过` 与 `A3 通过`（两段同一次运行内成对执行）

- [ ] [BEHAVIOR] 变异证明：把闸改回「有头则读头」，A1 必须转红（守卫 proven-to-fire，不是空的）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A1-header-fallback
  期望: exit 0，输出含 `A1-header-fallback proven-to-fire`

### Step4 — 表级可见性真访问控制（A8）

- [ ] [BEHAVIOR] 「仅自己」表：同组织他人列表不含且 GET 返 404 与随机不存在 id 逐字节相同；同时刻表主本人 2xx 且内容逐字一致
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a8-only
  期望: exit 0，输出含 `A8 反向通过` 与 `A8 正向对照通过`

- [ ] [BEHAVIOR] 变异证明：可见性判据改成「一律拒绝」，A8 正向对照必须转红（堵「对所有人一律 404」的假绿）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A8-deny-all
  期望: exit 0，输出含 `A8-deny-all proven-to-fire`

### Step5 — 删表二次确认 · 软删可还原（A9 / A30①）

- [ ] [BEHAVIOR] 确认名不匹配返 400 `CONFIRM_MISMATCH` 且不删；删后 `deleted_at` 非空而物理行仍在；30 天内还原后元数据与字段定义逐字回归
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a9-only
  期望: exit 0，输出含 `A9 通过`

- [ ] [BEHAVIOR] 变异证明：软删改成物理 `DELETE`，A9 必须转红
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A9-hard-delete
  期望: exit 0，输出含 `A9-hard-delete proven-to-fire`

### Step6 — G0 机械闸（A2）

- [ ] [BEHAVIOR] 路③ 全部路由与中间件源码七个禁用字面量零命中，且路③ 挂载路径以 `/api/knowledge/db` 开头
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a2-only
  期望: exit 0，输出含 `A2 通过`

- [ ] [BEHAVIOR] 变异证明：七个字面量逐个插入，守卫每次都报红（7/7 proven-to-fire，少一个即有漏网）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A2-inject-all
  期望: exit 0，输出含 `A2 变异 7/7 proven-to-fire`

### Step7 — G1 旧 `/api/fields` J7 五段（A4）

- [ ] [BEHAVIOR] A4 五段全绿：新表 `org_id NOT NULL` 跨企业读改被拒 / 旧四端点无身份返 401 / 旧表跨企业隔离且 B 行未变 / 回归 spec 无 `page.route` / 处置结果落 decisions
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a4-only
  期望: exit 0，输出含 `A4 五段全绿`

- [ ] [BEHAVIOR] 段③ 两个既有 smoke 改带身份头后自己仍是绿的（挂鉴权把它们打成 401 是必然，必须同刀修）
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/fields-smoke.sh && bash .github/workflows/scripts/smoke/zenithjoy-smoke-audit.sh'
  期望: 两个脚本均 exit 0

### Step8 — G2 备份与恢复演练（A5）

- [ ] [BEHAVIOR] 真 `pg_dump` → 还原到临时库 → 路③五表行数与关键字段逐条比对全等（回执不是 pg_dump 退出码）
  Test: manual:bash .github/workflows/scripts/backup/restore-drill.sh
  期望: exit 0，输出含 `A5 五表逐条全等`

### Step9 — 单组织前置自检 fail-closed（A11）

- [ ] [BEHAVIOR] 正常态服务起得来且启动日志含 `A11 single-org selfcheck passed`；多组织行时进程在 listen 之前退出、日志点名 `A11-MULTI-ORG`；请求期返 409 `MULTI_ORG_MEMBER`
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a11-only
  期望: exit 0，输出含 `A11 通过`

- [ ] [BEHAVIOR] 变异证明：自检改回「取第一条」，A11 必须转红
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A11-take-first
  期望: exit 0，输出含 `A11-take-first proven-to-fire`

### Step10 — A35① 前向兼容锚 + A33 接线（含真跑判据）

- [ ] [BEHAVIOR] 排除清单五个表名逐字命中，且删任一表名/删整个文件守卫必须报红（5/5 proven-to-fire）
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a35-only && bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --mutation A35-drop-name'
  期望: 两段均 exit 0，输出含 `A35 通过` 与 `A35 变异 5/5 proven-to-fire`

- [ ] [BEHAVIOR] A33 四段静态判据全绿：`on:` 含 `pull_request` / 有 `windows-latest` job 且它跑全链 / 该 job 无事件条件门 / `paths` 含路③ spec 与源码
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --a33-only
  期望: exit 0，输出含 `A33 四段全绿`

- [ ] [BEHAVIOR] 接缝 S3/S4 真验：本分支上该 workflow 的 windows-latest job 真跑过且 `conclusion == success`（`skipped` 判 FAIL）
  Test: manual:bash -c 'BR=$(git rev-parse --abbrev-ref HEAD); RID=$(gh run list --workflow e2e-knowledge-hub-path3.yml --branch "$BR" --limit 1 --json databaseId | jq -r ".[0].databaseId // empty"); [ -n "$RID" ] || { echo "FAIL: 分支无该 workflow 运行记录，A33 接线未成"; exit 1; }; gh run view "$RID" --json jobs | jq -e "[.jobs[] | select(.name|test(\"windows\")) | select(.conclusion==\"success\")] | length > 0"'
  期望: exit 0（`skipped` 会让 jq 断言为假 → FAIL，正是 A33(c) 要堵的孤儿 spec 形态）

## INV 条目（PRD 铁律逐条覆盖）

- [ ] [BEHAVIOR] INV-1 [租户隔离] 路③ 每条触碰五表的 SQL 都带 `org_id` 条件，且运行时跨企业读改返 4xx/空集
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-tenant-isolation
  期望: exit 0，输出含 `INV-1 通过`

- [ ] [BEHAVIOR] INV-2 [端点鉴权] 路③ 九个端点无会话逐个返 401，且旧 `/api/fields` 四端点无身份逐个返 401（无鉴权端点不准 ship）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-endpoint-auth
  期望: exit 0，输出含 `INV-2 通过 13/13`

- [ ] [BEHAVIOR] INV-3 [测试默认多租户] smoke 与 tests 均种 ≥2 个企业并断言互不串（单租户种子会让隔离漏洞永远看不见）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-two-tenant-seed
  期望: exit 0，输出含 `INV-3 通过`

- [ ] [BEHAVIOR] INV-4 [凭据安全] 本刀全部交付物零硬编码 secret（连接串/token/密钥字面量）
  Test: manual:node .github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff apps/api/src/knowledge apps/api/src/middleware/workbench-auth.ts .github/workflows/db-backup.yml .github/workflows/e2e-knowledge-hub-path3.yml
  期望: exit 0，输出含 `INV-4 零命中`

- [ ] [BEHAVIOR] INV-5 [日志脱敏] 真跑一轮建表后，`apps/api` 日志中不出现表名/字段名/单元格值正文（只许出现 id）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-log-redaction
  期望: exit 0，输出含 `INV-5 通过`

- [ ] [BEHAVIOR] INV-6 [真环境验证才算done] 接缝清单 S1–S5 逐条有真目标证据；未真验项必须显式标 `logic-done-pending`，不得标 done
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-seam-ledger
  期望: exit 0，输出含 `INV-6 接缝清单 5 条逐条有据`

- [ ] [BEHAVIOR] INV-7 [禁写死环境假设值] 交付脚本零硬编码端口/UUID/连接串字面量，全部从 env 推导或运行时生成
  Test: manual:node .github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs .github/workflows/scripts/smoke/structured-workbench-smoke.sh .github/workflows/scripts/backup/restore-drill.sh sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/e2e-verify.ps1
  期望: exit 0，输出含 `INV-7 零命中`

- INV-8 [单slot串行] **N/A：** 该铁律约束的是 harness 执行编排（同一时刻只有一个实现者动手），不是本 sprint 交付物的可观测属性，无法也不应在交付物上立机械断言。

- [ ] [BEHAVIOR] INV-9 [表名认领] 五张新表在 `origin/main` 上零既有写入方（建表前已 grep 全部写入方，无 schema 撞车）
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-table-claim
  期望: exit 0，输出含 `INV-9 五表零撞车`

- [ ] [BEHAVIOR] INV-10 [语义重叠消解] `db_fields` 与旧 `field_definitions` 的语义重叠已由正式 decision 消解（不合并 + 各自隔离口径），不是「留给后续技术债 sprint」
  Test: manual:bash .github/workflows/scripts/smoke/structured-workbench-smoke.sh --inv-decision-recorded
  期望: exit 0，输出含 `INV-10 decision 已落库`（脚本内查 `decisions` 表：正文同时含 `1ae57f1a` 与 `field_definitions`，且写明「不下线端点」与「加租户列的范围扩张」两点）

## BEHAVIOR:E2E 条目（user_facing，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 员工在 windows-latest 干净 VM 的真浏览器里走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-empty-workbench.png   期望：空工作台，≥2 张开箱模板卡片可见（A7）
    - 02-create-table.png      期望：建表表单已填 8 类字段各一 + 可见性选择器可见，提交按钮可点（A6）
    - 03-table-in-list.png     期望：新表出现在本组织工作台列表，字段数 = 8（A6）
    - 04-delete-confirm.png    期望：删表二次确认弹窗要求输入表名，输错时删除按钮禁用（A9）
    - 05-trash-restored.png    期望：回收站还原后表回到列表，字段定义与建表时逐字相同（A9/A30①）
  期望：所有截图与期望描述一致，Claude Read 图自验通过；截图 `LastWriteTime` 晚于脚本启动（防历史产物冒充）
  路径格式：sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/screenshots/<step>.png
