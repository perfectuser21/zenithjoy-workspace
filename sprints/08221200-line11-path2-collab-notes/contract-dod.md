---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
gp_anchor: line11/collaborative_docs#step1
---
# Contract DoD — 路② 协同笔记/文档 第一刀（S1+S2+S3 单 org 端到端可用）

**范围**: documents 表 + document_members 表 / TipTap 3.x 跨 app 移植进 staff-hub / ProseMirror schema 属性协议白名单（HTTP 保存 + CRDT-CV 共用单一实现）/ 文档 CRUD+树+搜索+移动+软删回收站+导出 Markdown / Yjs + y-prosemirror 实时协同 + awareness 多人光标 / `/collab-ws` 手写 cookie 会话握手（单 org 建房、多 org fail-closed、会话失效断连、doc 权校验）/ 服务端 CRDT-CV / 三档可见性 + 六处过滤 + most-restrictive 继承 + member live 校验 + fail-closed 503 / G2 备份恢复演练
**不在范围**: S4/S5（AI 读/写回、检索器、opt-out）；多 org 正常协同（active_org 未定）；Notion/飞书导入；@人通知；评论/内嵌 database/版本回滚
**大小**: L

> 全部 `manual:` 命令工作目录 = repo 根。DB 断言的 `PG`/vitest 的 `E2E_DATABASE_URL` 取 `${E2E_DATABASE_URL:-$DATABASE_URL}`，须指 **zenithjoy** 库（本地 cecelia 库已含 zenithjoy schema）；未设时命令自身报错退出，**不落默认库**。
> **判定归 DoD、供给归脚本**（沿用路③ 范式）：`dod-run.sh <suite>` 只负责用 `vitest.collab-notes.config.ts` 跑对应合同测试文件（测试自持双企业种子），pass/fail 判据 = vitest exit code。security 断言（A1/A2/A4/A3-*/A10）由真 apps/api + 真 Postgres + 真 collab-ws + 真 ws 客户端跑出。
> **接缝三条未真验前不得标 done**（见合同接缝语义）：CRDT 双人字符级合并 / 断连 resync 横幅 / 多人光标——只在 windows job（e2e-verify.ps1）转绿，linux vitest 绿 ≠ done，未真验标 `logic-done-pending`。
> **变异一律外置判据**（proven-to-fire）：contract-draft `## 变异守卫清单` 7 项，evaluator 抽验时注掉守卫、复跑对应 suite，判据是「被守卫的那条 suite 自己 exit≠0」，不认脚本自述。

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration 建 `zenithjoy.documents`（org_id NOT NULL / parent_id / title / owner_member_id / visibility / content jsonb / crdt_state bytea / ai_retrieval_opt_out bool DEFAULT false / deleted_at）+ `zenithjoy.document_members`（doc_id / member_id）
  Test: node -e "const fs=require('fs'),d='apps/api/db/migrations';const f=fs.readdirSync(d).filter(n=>/documents|collab_notes|collaborative/.test(n)&&n.endsWith('.sql'));if(!f.length)process.exit(1);const c=f.map(n=>fs.readFileSync(d+'/'+n,'utf8')).join('\n');for(const r of [/CREATE TABLE[^;]*zenithjoy\.documents/i,/org_id[^;]*NOT NULL/i,/crdt_state\s+bytea/i,/content\s+jsonb/i,/ai_retrieval_opt_out\s+bool(ean)?[^;]*DEFAULT\s+false/i,/deleted_at/i,/zenithjoy\.document_members/i])if(!r.test(c))process.exit(1)"

- [ ] [ARTIFACT] schema 白名单单一实现：`apps/api/src/workbench/document-schema.ts` 存在，HTTP 保存路径与 collab-ws CV 路径**均 import 同一导出**（源码两处引用同一符号）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('apps/api/src/workbench/document-schema.ts'))process.exit(1);const files=['apps/api/src/workbench/document.service.ts','apps/api/src/services/collab-ws.ts'].filter(p=>fs.existsSync(p));if(files.length<2)process.exit(1);for(const p of files){const c=fs.readFileSync(p,'utf8');if(!/document-schema/.test(c))process.exit(1)}"

- [ ] [ARTIFACT] collab-ws 挂载：`apps/api/src/services/collab-ws.ts` 存在且 `apps/api/src/index.ts` 调 `attachCollabWS(server)`；路径 `/collab-ws` 独立于 `/agent-ws`
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('apps/api/src/services/collab-ws.ts','utf8');if(!/\/collab-ws/.test(s))process.exit(1);const i=fs.readFileSync('apps/api/src/index.ts','utf8');if(!/attachCollabWS\s*\(\s*server\s*\)/.test(i))process.exit(1)"

- [ ] [ARTIFACT] 版本锁：`apps/staff-hub/package.json` 含 @tiptap/react、starter-kit、extension-image、extension-link、extension-collaboration、extension-collaboration-cursor、yjs、y-prosemirror，tiptap 为 3.x
  Test: node -e "const p=require('./apps/staff-hub/package.json'),d={...p.dependencies,...p.devDependencies};for(const k of ['@tiptap/react','@tiptap/starter-kit','@tiptap/extension-image','@tiptap/extension-link','@tiptap/extension-collaboration','@tiptap/extension-collaboration-cursor','yjs','y-prosemirror']){if(!d[k])process.exit(1)}if(!/3\./.test(d['@tiptap/react']))process.exit(1)"

- [ ] [ARTIFACT] 服务端 CRDT 依赖：`apps/api/package.json` 含 yjs + y-prosemirror（服务端 apply + CV 派生 doc 需要）
  Test: node -e "const p=require('./apps/api/package.json'),d={...p.dependencies,...p.devDependencies};if(!d['yjs']||!d['y-prosemirror'])process.exit(1)"

- [ ] [ARTIFACT] 接线三件套：`apps/api/vitest.collab-notes.config.ts` 白名单含本 sprint tests 目录 + `apps/api` 有 `test:collab-notes` 脚本 + `dod-run.sh` 存在
  Test: node -e "const fs=require('fs');const p='apps/api/vitest.collab-notes.config.ts';if(!fs.existsSync(p))process.exit(1);if(!fs.readFileSync(p,'utf8').includes('sprints/08221200-line11-path2-collab-notes/tests'))process.exit(1);const s=require('./apps/api/package.json').scripts||{};if(!s['test:collab-notes'])process.exit(1);if(!fs.existsSync('sprints/08221200-line11-path2-collab-notes/dod-run.sh'))process.exit(1)"

- [ ] [ARTIFACT] E2E workflow `e2e-knowledge-hub-path2.yml`：windows job **无 job 级 if 门**，paths 含本 sprint + linux job 真跑 `test:collab-notes`（真 Postgres service）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-knowledge-hub-path2.yml','utf8');if(!/sprints\/08221200-line11-path2-collab-notes/.test(c))process.exit(1);if(!/test:collab-notes/.test(c))process.exit(1);if(!/postgres/i.test(c))process.exit(1);const win=c.split(/\n  [a-z0-9-]*windows[a-z0-9-]*:\n/i)[1]||'';const head=win.split(/\n    steps:/)[0];if(/^\s{4}if:/m.test(head))process.exit(1)"

- [ ] [ARTIFACT] CRDT 双人 spec：`apps/staff-hub/e2e/collab-notes-crdt.spec.ts` 存在、**零请求拦截**（变体C 死规则），逐字含两 context / 光标 / 断连横幅 / 仅自己 404 断言
  Test: node -e "const c=require('fs').readFileSync('apps/staff-hub/e2e/collab-notes-crdt.spec.ts','utf8');if(/page\.route|context\.route|fulfill\(/.test(c))process.exit(1);for(const s of ['newContext','cursor','setOffline','private'])if(!c.toLowerCase().includes(s.toLowerCase()))process.exit(1)"

- [ ] [ARTIFACT] G2 备份恢复：documents pg_dump + 恢复演练脚本存在且进 cron 配置（`db-backup.yml` 或 cron 引用）
  Test: node -e "const fs=require('fs');const drill='sprints/08221200-line11-path2-collab-notes/backup-restore-drill.sh';if(!fs.existsSync(drill))process.exit(1);const c=fs.readFileSync(drill,'utf8');if(!/documents/.test(c)||!/pg_dump|pg_restore/.test(c))process.exit(1);const wf=fs.existsSync('.github/workflows/db-backup.yml')?fs.readFileSync('.github/workflows/db-backup.yml','utf8'):'';if(!/documents|collab|backup-restore-drill/.test(wf))process.exit(1)"

## BEHAVIOR 条目

> 每条都能回答「Golden Path 哪一步的用户可观察输出」，且对应代码一行没写时必然 FAIL（`/api/workbench/documents` 端点族、`documents` 表、`collab-ws.ts` 在 origin/main 上都不存在）。

- [ ] [BEHAVIOR] A2 S1 写留 + XSS/SQL + 自动保存不静默：建档→写→存→刷新在 / 导出 Markdown 往返 / javascript: 与 onerror 入库前剥离 / DROP TABLE 标题参数化表仍在 / PATCH 已删或畸形正文返 4xx（documents-crud-xss.test.ts 全过）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/dod-run.sh a2'
  期望: exit 0（Test Files passed）

- [ ] [BEHAVIOR] A1 cross-tenant 六层隔离：B 会话对 A 文档 读/搜/导出/@提及/正文/移动/删 全 404 且 A 正文逐字未变 / 伪造 org_id 落库仍归 B / 无权与不存在 404 md5 全等（cross-tenant-isolation.test.ts 全过）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/dod-run.sh a1'
  期望: exit 0

- [ ] [BEHAVIOR] A4 权限三档 + 六处过滤 + 继承 + live 校验 + fail-closed：private 五处 404 / members 命中可读 / 删 tenant_members 后立即不可达 / 父级 private 子档取严 404 / 权限查询失败 503（permissions.test.ts 全过）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/dod-run.sh a4'
  期望: exit 0

- [ ] [BEHAVIOR] A3-b/c/d/e + A10 collab-ws：无 cookie/跨企业/多 org 握手全拒绝不建房 / 单 org 建房发 Yjs update 落库 crdt_state 非空 / 会话失效下一写操作断连 / 注入 onerror+javascript: 的 update 落库 crdt_state 与 content 均不含（collab-ws.test.ts 全过）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/dod-run.sh ws'
  期望: exit 0

- [ ] [BEHAVIOR] A9 路① CRUD 回归：POST /api/staff/knowledge/entries 建经验 201 / GET /recent 含之 / GET /projection 200（route1-regression.test.ts 全过，参照 PR#1676 教训不回归）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/dod-run.sh a9'
  期望: exit 0

- [ ] [BEHAVIOR] documents 表已建且形状正确：to_regclass 非空、org_id NOT NULL、crdt_state bytea 列在
  Test: manual:bash -c 'PG="${E2E_DATABASE_URL:-$DATABASE_URL}"; psql "$PG" -tAc "SELECT to_regclass('"'"'zenithjoy.documents'"'"')" | grep -q documents && psql "$PG" -tAc "SELECT is_nullable FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'documents'"'"' AND column_name='"'"'org_id'"'"'" | grep -q NO && psql "$PG" -tAc "SELECT data_type FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'documents'"'"' AND column_name='"'"'crdt_state'"'"'" | grep -q bytea'
  期望: 三段全过（表在 + org_id NOT NULL + crdt_state bytea）

- [ ] [BEHAVIOR] A7 G2 备份恢复演练：pg_dump documents → 还原临时库 → content jsonb/crdt_state/org_id/visibility/parent_id/deleted_at/ai_retrieval_opt_out 逐条比对一致（脚本退出码 0）
  Test: manual:bash -c 'bash sprints/08221200-line11-path2-collab-notes/backup-restore-drill.sh'
  期望: exit 0（备份→还原→逐字段比对一致）

## BEHAVIOR:E2E 条目（user_facing，windows_cloud Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 双 browser context 模拟甲乙两人同编同一文档：字符级合并 + 多人光标 + **断连 resync 零丢字（硬断言）** + 设「仅自己」后第三 context 404（见 contract-draft `## E2E 验收` e2e-verify.ps1）
  Screenshots:
    - 01-two-editors.png    期望：两 context 并排打开同一文档，双方编辑器可见
    - 02-merged-cursors.png  期望：两人各自输入均在、字符级合并无覆盖、对方光标可见
    - 03-resync-merged.png   期望：A 断网各自离线输入 α/β → A 重连 resync 后，A、B 两 context DOM 均含 α 与 β（零丢字）
    - 04-private-404.png      期望：设「仅自己」后第三 context 打开该文档得「不存在/无权」（404）
  期望：所有截图与期望一致，evaluator Read 图自验通过；截图存入 sprints/08221200-line11-path2-collab-notes/screenshots/

## 变异守卫全绿要求

- [ ] [ARTIFACT] contract-draft `## 变异守卫清单` 7 项齐（WS 握手鉴权 / WS doc 权 / WS 多 org rows[0] / WS 会话失效 / 身份读头回落 / member live / 服务端 CV），evaluator 抽验注掉任一守卫对应 suite 必转红（proven-to-fire，样本跨断裂点）
  Test: node -e "const c=require('fs').readFileSync('sprints/08221200-line11-path2-collab-notes/contract-draft.md','utf8');const seg=c.split('## 变异守卫清单')[1]||'';const n=(seg.match(/^\d+\./gm)||[]).length;if(n<7)process.exit(1)"

## 出口条件

- 条目全绿；单 org 成员端到端可用（建档写存刷新在 → 第二人实时字符级合并+多人光标 → 设「仅自己」第三人打不开/搜不到/进不了协作），多 org 分支 fail-closed 登记待 active_org（不阻塞关闭）。
- A5/A6/A8-AI 尾段（S4/S5）不在本刀，明确留后续刀。
