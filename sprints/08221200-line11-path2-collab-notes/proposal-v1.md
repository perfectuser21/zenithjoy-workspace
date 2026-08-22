# 员工知识中枢 路② 协同笔记/文档 Golden Path v1

提案人：Cecelia（AI）。本提案基于 GP 定义 v1（三镜头 GAN 收敛版，`path2-definition-v1.md`）+ 现状探索报告（`.harness/explore-report.md`，实锤基准 `origin/main`，本 worktree 落后 58 commit）。**主理人 0822 拍板 Q1=实时 CRDT（腾讯文档式多人光标、字符级合并），定义 v1 中 S2「乐观锁 thin」表述作废**，本提案以 CRDT 实时协同为 S2 承诺重写，并如实评估其净新增规模、CRDT 库选型、实时 WS 通道方案，以及被 `active_org` 外部依赖阻塞的部分。

**GP_ID**：`301bd18f-ba56-4e57-b99f-3d0a1e90fad5`（golden_paths，status=candidate，journey=da60cb26，capability_code=`collaborative_docs`）
**一句话**：员工要写一篇文档（会议纪要/SOP/方案/wiki）→ 在 Staff Hub 建文档、写富文本、组织成文档树、多人实时协同（CRDT）、按组织权限管住、AI 一等公民能读能写回且受同一权限约束不投毒、与经验打通，数据按组织隔离可导出、删错可恢复。

---

## 0. 相对定义 v1 的结构性修订（本提案定案口径）

1. **S2 协作模型从「乐观锁 thin」升级为「实时 CRDT」**（主理人拍板 Q1）。定义 v1 §S2、不做清单、切刀表、场景八格里所有「乐观锁 409 / loser 零丢失 / 整档 version」表述**作废**，改为「字符级自动合并 + 多人光标 + 断连本地暂存重连 resync」。乐观锁不再是本路承诺，`version int` 乐观锁列不建（CRDT 用 state vector / update log 做并发真相）。
2. **「镜像路③乐观锁」措辞全删**。探索报告实锤路③无 `version` 列、`workbench.service.ts` 逐行读写零乐观锁（`.harness/explore-report.md` 表行「乐观锁/version 列」+ 表行「JSONB 存储范式」）。**并发控制 100% 净新增**；仅 **JSONB 行存 + org_id NOT NULL + 软删 30 天 + 回收站 + db_audit** 范式可照搬（`apps/api/db/migrations/20260820_120000_structured_workbench.sql`、`apps/api/src/services/workbench.service.ts:createTable/softDeleteTable/restoreTable`）。
3. **删「S4/S5 复用路①问答」**。探索报告实锤 `apps/api/src/routes/knowledge.ts` 全文仅 CRUD（`POST /entries` 写 `public.learnings`、`GET /recent`、`GET /projection`），**无任何检索/问答/LLM/embedding/vector**；全仓无 pgvector。**路①没有 AI 层可复用**。S4/S5 的 AI 检索索引、纯文本抽取、带出处问答、写回=**净新增**；`apps/api/src/llm/openrouter.ts` 真实存在但**唯一消费者是 Line04 微信客服**（`services/wechat-draft.ts` 等），可作 **library 复用**（OpenAI 兼容调用 + 思考剥离 + CI max_tokens cap），但「line11 AI 助手横切层」不存在，须新建并接线。
4. **首刀不含导入**（主理人拍板 Q2）。Notion/飞书批量导入迁移留后续，新文档从零写。
5. **新增「## 外部阻塞项」段**：`active_org` 多组织模型现状为空（探索报告实锤 `git grep active_org|activeOrg|current_org` 零命中，现状一员工多 org 即 409 fail-closed，`apps/api/src/middleware/workbench-auth.ts:92`）。路② 的 **WS 连接 org 声明** 与 **S4/S5 AI 读/写身份的 org 归属** 依赖另一 multiorg agent 正在定的 `active_org` 模型，**最终形态待其定案后确认**，本提案显式标注为外部依赖，不假装已解决。

---

## 外部阻塞项（批准前须知，非本路可独立收口）

| 阻塞项 | 现状实锤 | 对本路的影响 | 处置 |
|---|---|---|---|
| **`active_org` 多组织模型未定** | 探索报告：`active_org/activeOrg/current_org` 全 origin/main 零命中；现状一员工命中多 org 即 409 fail-closed（`workbench-auth.ts:92`），无「当前组织」概念 | ① **WS 协作房 org 声明**最终形态未定：单 org 成员可从会话唯一推出 org；**多 org 成员当前 409，无法进任何协作房 / AI 读写**；② S4/S5 「复用 `req.workbenchIdentity`」中的 org 维度待 active_org 对齐 | **不阻塞 S1**（单档写留与 org 无歧义）。**S2/S4/S5 的多 org 分支设计冻结在「单 org 成员可用 + 多 org 成员 fail-closed 409」下限**，待 active_org 定案后由 controller 补 org 声明形态；本提案的 WS/AI org 断言以「单 org 成员端到端可用、多 org 显式 fail-closed 不越权」为验收下限，**禁在 active_org 未定时替 multiorg agent 猜测 active_org 语义** |

---

## Gate 前置段（前置门 · 碰生产 DB / 真实 LLM / 跨租户真墙 / windows_cloud 真机 E2E，任一不过整条路停）

> 本路碰四类真实世界接缝（探索报告 §② 逐条非空）：生产 DB 写入（文档正文=企业核心资产）、真实第三方 LLM（S4/S5 真 key 真调用）、跨企业多租户真墙（六层）、WS 长连真机 E2E。故 S2/S4/S5 验证等级承诺**必须 L3**，四道 Gate 全绿方进对应步骤。

| 门 | 内容 | 现状标注（探索实锤） | 断言（冻结） |
|---|---|---|---|
| **G0 组织底座衔接** | 路② 全部文档端点（含 WS 升级、AI 读/写端点）挂 `workbenchAuthGuard`：身份/org **只**来自服务端会话，禁读身份头、禁 `body.org_id` 生效、禁超管旁路、禁 selfHeal。A2 式静态守卫扫路② 路由/service/WS 身份头字面量 | **已有（非死代码）**：`apps/api/src/middleware/workbench-auth.ts` 真实挂载 `apps/api/src/routes/workbench.ts:67 router.use(workbenchAuthGuard)`；身份=`auth.api.getSession(fromNodeHeaders(req.headers))`→`tenant_members` 真查（L63/L79），四态齐全，多 org fail-closed 409（L92），反枚举 404 无 timestamp（`notFoundBody` L54）。**⚠️ 但它是纯 Express cookie-session 中间件，不能 drop-in 到 WS 握手**（见 G0b / J2） | 持 B 企业真实会话 + 伪造 `org_id` 指向 A → 4xx/空集且 A 文档逐字未变；变异=改回读身份头即报红 |
| **G0b WS 握手鉴权（本路最大接缝，净新增）** | WS upgrade **不过 Express 中间件链**（`agent-ws.ts` 自陈）；握手须**手写**复用 better-auth 会话解析：`auth.api.getSession({headers: fromNodeHeaders(upgradeReq.headers)})`→`tenant_members` 真查 → memberId+orgId；协作房按 `(org_id, doc_id)` 强隔离，**每连接**校验请求者对该 doc 有编辑权（S3），会话过期即断连重验（长连不静默续命）。WS 连接须声明 org（形态待 active_org，见外部阻塞项） | **半成（模式可抄，鉴权净新增）**：`apps/api/src/services/agent-ws.ts` 有 `ws` 库 `WebSocketServer({noServer:true})` + `server.on('upgrade')` 手动升级 + 30s ping/pong，真实 wired `apps/api/src/index.ts:33 attachAgentWS(server)`。**但其鉴权是 agent 机器 token（license_key/ws_token）、路径 `/agent-ws`，非 cookie 会话**——挂载/升级/心跳**模式**可抄，cookie 会话握手 + 协作房 + 每连接 doc 权校验=净新增 | B 企业会话连 A 企业 doc 协作房 → 拒绝且拿不到任何在线/正文信号；无有效会话握手 → 拒绝不建房；变异=注掉握手鉴权/注掉 doc 权校验必须转红 |
| **G1 富文本存储与 XSS 面** | 正文权威快照存 **ProseMirror JSON doc → `documents.content jsonb`**；CRDT 二进制 state 存 `documents.crdt_state bytea`（见 J3）。用户输入的标题/正文永远只做数据值走绑定参数，SQL 注入面物理为零；渲染 XSS 由 ProseMirror schema 白名单收窄——**含节点/mark 属性协议白名单**（link href 仅 http/https/mailto，image src 禁 `javascript:`/`data:`），禁 raw HTML。**AI 写回入库过与人手同一条服务端 schema 校验**（防绕过写白名单外节点=存储型 XSS） | **半成**：`@tiptap/react`/`starter-kit`/`extension-image`/`extension-link` ^3.19 在 `apps/dashboard/package.json`，**`apps/staff-hub/package.json` 无 tiptap/prosemirror**（有 @dnd-kit/core、ag-grid）；须像路③ AG Grid 一样**跨 app 移植**进 staff-hub + 加 schema 白名单。`documents` 表**缺失**（`git grep zenithjoy.documents` 空） | 正文注入 `<img onerror>`/`href=javascript:` → 渲染后文本节点/协议被剥；标题含 `"; DROP` → 参数化不触发；AI 构造非白名单节点入库 → 服务端拒 |
| **G2 备份底线** | 文档正文 + CRDT state = 企业核心资产，pg_dump 定时 + 异地 + **恢复演练断言**（复用路③ G2 范式） | **缺失（范式可照搬）**：软删/回收站/审计范式在 `workbench.service.ts` 已有，`documents` 备份 job 净新增 | 从备份还原到临时库，`content` JSONB + `crdt_state` + 关键字段逐条比对（L2）；演练进 cron 非一次性 |
| **G3 文档纳入 AI 检索域（路② 独有命门）** | 路② 文档进 QA 检索域（**与路③ 排除相反**）。前置定死三条不变式：① **权限过滤前置于召回**——index 行携带 `org_id` + effective-visibility，禁「先召回候选再过滤」把无权标题/片段喂进 LLM；② **未确认 AI 草稿块不进检索**（pending 标记，索引器跳过）；③ **正文一律当不可信数据**（分隔 + 来源标注，输出不自动执行/不自动落库）——这才是投毒真防线，人工确认闸不是 | **净新增（检索器整体不存在）**：`apps/api/src/knowledge/retrieval-exclusions.ts` 只是给「路①问答检索（后续刀）」的前向锚，**检索器本身尚未建**；路① knowledge.ts 纯 CRUD 无检索。G3 不是「改排除清单」而是「从零建带权限前置过滤的检索器 + 显式纳入标记」 | 见 S4/S5 断言；变异=删任一不变式断言报红 |

---

## Golden Path 步骤（承诺式骨干，5 步）

> 步骤名 = 客户/老板可感知的承诺；工序细节下沉【挂片】【分支/判定点】。现状标注一律引用探索报告实锤。

| 步骤（承诺） | 现状 | 验证等级承诺 | 【挂片】 | 【分支/判定点】 |
|---|---|---|---|---|
| **S1 文档写得出、留得住**——员工在文档树某节点新建文档，写富文本正文（标题/段落/列表/勾选/代码块/内嵌图片/@提及其他文档），保存刷新还在，出现在本组织文档树；可移动/重命名/软删 + 30 天回收站；整篇可导出 Markdown 拿走 | **半成**：编辑器 TipTap 在 dashboard 有、staff-hub 无（跨 app 移植）；`documents` 表缺失；JSONB 软删/回收站/审计范式已有可照搬；staff-hub 已装 `@dnd-kit/core`（树拖拽可复用，`apps/staff-hub/package.json`） | **L2（服务端真验）** | 文档树 UI（folder/doc 层级 + 拖拽移动）／TipTap 跨 app 移植 + staff-hub 主题 + schema 白名单含属性协议／`documents` 表（id UUID、org_id NOT NULL、parent_id、title、owner_member_id、visibility、`content jsonb`、`crdt_state bytea`、deleted_at）／自动保存（防抖落库）／软删 + 回收站 + 删档二次确认（输入标题）／Markdown 单档导出（明写对图片/@提及的有损范围）／db_audit 审计行 | 分支：自动保存失败（弱网/500）必须编辑器可见并保留本地草稿，禁静默丢失（现状 `CustomerListPage` 全量重拉掩盖失败，不得继承）。分支：@提及目标校验同 org + 请求者有权可见（无权/跨企业 id → 统一 404 不泄标题）。判定点 J3：正文存储形态（ProseMirror JSON + CRDT state 双写）。判定点：内嵌图片禁 base64 入 JSONB，走对象存储只存引用（误判后果：撑爆行 + 放大整档写） |
| **S2 多人实时协同、字符级不打架**——多个员工同时编辑同一篇文档，看得到别人的光标在哪、正在改哪里，两人改不同段落**字符级自动合并互不覆盖**、改同一句也无静默丢字；断连降级只读 + 本地暂存并提示，重连自动 resync 合并 | **净新增（重）**：CRDT 引擎零（`git grep -i yjs|automerge|y-websocket|socket.io` 零命中）；WS 基础设施半成（`agent-ws.ts` 模式可抄，cookie 会话握手/协作房/CRDT 全净新增）；乐观锁/version 列路③ 实测无、不复用 | **L3（真机真验）** | CRDT 引擎（**推荐 Yjs**，见 J1）／`y-prosemirror` 绑定接 TipTap／**awareness** 多人光标 + 在线协作者指示／WS 协作通道（`ws` 库 noServer + upgrade，抄 `agent-ws.ts:attachAgentWS` 模式，**路径 `/collab-ws`**）／握手 cookie 会话鉴权（G0b）／CRDT update 落库 + `content jsonb` 快照派生／断连只读降级横幅 + 本地暂存 + 重连 resync ／版本历史最小档（回看上一版快照） | 判定点 J1：CRDT 库选型（Yjs vs Automerge）。判定点 J2：WS 握手鉴权方案（手写 cookie 会话解析）。判定点 J3：CRDT 持久化形态（update log/state bytea + ProseMirror JSON 快照双写）。分支：会话过期即断连重验（长连不静默续命）。分支：**多 org 成员当前 409 无法进协作房**（外部阻塞 active_org，验收下限=单 org 成员端到端可用）。分支：协作房按 `(org_id, doc_id)` 强隔离，每连接校验 S3 编辑权（tech：可见≠可编辑=协作准入） |
| **S3 文档按权限管得住**——文档/文件夹设可见范围与可编辑范围（组织可见／指定成员集合／仅自己 三档），权限沿文档树继承、**取父子更严者（most-restrictive-wins）**；无权的人看不到标题、不在树、搜不到、打不开、导不走、进不了协作、AI 检索不到 | **半成**：员工目录只有 org+member 两层（`apps/api/src/staff-directory.ts:parseOrgGroups`，A30 fail-closed），**无部门/分组层**；cross-tenant 隔离底座已有（G0） | **L2（服务端真验）** | 权限设置 UI（每文档/文件夹选 visibility + 回显**实际生效范围**）／继承解析器（most-restrictive）／**七处过滤**（树·搜索·打开·导出·@提及·协作准入·AI 检索）／编辑权限校验（可见≠可编辑） | 判定点 J4：三层中间层来源（推荐 (b) 显式指定成员集合，不建部门表）。判定点 J5：成员集合生命周期——命中后**必须 live 校验该 member 仍属本 org（查 `tenant_members`）**，禁只信静态 id 列表（离职 + 未失效会话=越权读）。分支：继承 fail-safe——私密文档移进更宽父级不自动放宽，需二次确认 + 回显。分支：权限查询失败 → **fail-closed 503 不降级为可见**；反枚举无权与不存在统一 404 同文案同响应形状 |
| **S4 AI 读得到、答得准**——员工让 AI 就本组织**自己有权看到的**文档答问/摘要，答案**带出处**；AI 只在请求者本人已鉴权的同步请求内、复用其身份检索，绝不召回请求者无权/他企业/未确认草稿的内容 | **净新增**：路① 无 AI 层可复用（knowledge.ts 纯 CRUD）；`openrouter.ts` 可作 library（Line04 在用）；检索器/embedding/纯文本抽取全无 | **L3（真机真验）** | 文档进检索域索引（形态见 J6）／ProseMirror JSON → 纯文本抽取／带出处问答·摘要／line11 AI 助手横切层（**新建**，openrouter 作 library）／权限前置过滤器 | 判定点 J6：检索索引形态与纳入范围（显式标「可被 AI 检索」才进；thin=关键词倒排，embedding 加厚需向量库支持 org_id+visibility 元数据 pre-filter）。判定点 J8：AI 读身份——**只在请求者本人已鉴权同步 HTTP 请求内、作为服务端工具调用、复用 `req.workbenchIdentity`（org 维度待 active_org）**；禁任何需自带身份的异步/后台 AI 检索（误判后果：后台服务身份=越权召回全租户）。分支：软删/权限收紧后索引 N 秒内一致（陈旧 ACL=越权召回窗口）。分支：投毒防护硬断言（结构性防护存在，L3 真检索栈 + 真 LLM）+ 软断言（注入不改答案走 eval + LLM judge，标软） |
| **S5 AI 写得回、受同一权限约束**——员工让 AI 把内容写回文档成**可见的「AI 草稿」块**，人工确认后才成正文；AI 写回**复用请求者身份 + 过 S3 权限校验**，只 additive 插入不整档覆盖，绝不以系统身份写他人私密文档 | **净新增**：真实写库面（生产 DB），越权写他企业/他人私密文档面新增 | **L3（真机真验）** | AI 写回草稿块（pending 标记，不进检索直到确认）／人工确认闸（确认动作进 db_audit）／additive 插入（禁整档 replace）／写回过 G1 服务端 schema 校验 | 判定点 J8：AI 写回身份——同 S4，只在请求者已鉴权同步请求内复用 `req.workbenchIdentity` + 过 S3 编辑权，**禁后台服务身份写库**。判定点 J9：确认权归属——确认闸只保证「未确认不成正文」，**不是投毒防护**（真防线是 G3③ 数据分隔 + S4 未确认不进检索）；确认权**不能是投毒植入者自助确认**，确认进审计。分支：additive-only 禁整档 replace（链式覆盖丢内容）；跨企业/越权写 → 4xx 且目标文档逐字未变 |

### 切刀记录表（相邻边界 × T1–T4 × 结论）

| 相邻边界（片段A ｜ 片段B） | T1 可观察终态 | T2 失败可辨 | T3 独立 EV | T4 可停顿 | 结论 | 理由 |
|---|---|---|---|---|---|---|
| 员工登录/组织归属 ｜ 其余 | — | — | — | — | 前置件 | 共享前置上提为 Gate G0/G0b（复用路①③ 底座 + WS 握手净新增） |
| 建空文档 ｜ 写正文并保存 | ✘ | ✘ | ✘ | ✘ | 并入 S1 | 建空档无独立价值，一口气建+写+存 |
| S1 写留 ｜ S2 实时协同 | ✔ | ✔ | ✔ | ✔ | 切 | 单人存住 vs 多人字符级合并；写完可停几天再协作；失败面不同（丢字 vs 合并冲突/越权进房） |
| S2 协同 ｜ S3 权限 | ✔ | ✔ | ✔ | ✔ | 切 | 协同合并 vs 越权可见，不同失败；权限可在无协作时独立验收 |
| S3 权限 ｜ S4 AI 读 | ✔ | ✔ | ✔ | ✔ | 切 | 权限管住 vs AI 召回投毒，不同失败；AI 读受 S3 约束但可独立验收 |
| **S4 AI 读 ｜ S5 AI 写回** | ✔ | ✔ | ✔ | ✔ | **切** | 两终态（屏出答案 vs 树增草稿块并持久化）；两失败（答错/无出处 vs 草稿越权写库）；只读 vs 真实写库风险面根本不同，合并会把两种风险挤一格。5 步在上限 |
| S5 ｜ 版本全量回滚/评论/内嵌 database/导入 | — | — | — | — | 后刀加厚 | 显式不做清单 |

---

## 验收断言（A1–A9，冻结后 AI 不可改；均可转 psql / WS 客户端 / windows_cloud 真浏览器 / L3 真检索栈验证）

- **A1（G0/G0b cross-tenant 六层）**：持 B 企业真实会话，对 文档/文件夹/正文/@提及/协作房/检索域 六层任一伪造 `org_id` 指向 A → 4xx 或空集，且 A 文档逐字未变；B 会话连 A 的 `(org_id,doc_id)` 协作房 → 拒绝且拿不到任何在线/正文信号。**变异**：把 org 改回读身份头 / 注掉 WS 握手鉴权 → 必须转红。
- **A2（S1 写留 + XSS/SQL）**：建档→写富文本（含内嵌图片引用 + @提及）→存→刷新仍在→本组织树可见→导出 Markdown 往返；正文注入 `<img onerror>`/`href=javascript:` → 渲染后文本节点/协议被剥；标题 `"; DROP TABLE` → 参数化不触发。自动保存失败时编辑器可见提示且本地草稿保留（非静默丢失）。
- **A3（S2 实时 CRDT）**：两个已鉴权会话同时编辑同一文档不同段落 → 字符级自动合并、双方改动均在、**非 409**；改同一句无静默丢字；awareness 多人光标可见；断连 → 只读横幅 + 本地暂存，重连 → 自动 resync 合并。无有效会话握手连 `/collab-ws` → 拒绝不建房。**变异**：注掉握手鉴权 / 注掉 doc 权校验 → 必须转红。（**多 org 成员**：当前 409 fail-closed 不进房，验收下限=单 org 成员端到端可用，多 org 分支待 active_org。）
- **A4（S3 权限三档 + 七处过滤）**：设文档「仅自己」→ 他人在 树/搜索/打开/导出/@提及/协作准入/AI 检索 七处全部拿不到（统一 404 同文案同形状）；most-restrictive 继承：设父级「仅自己」后所有子档实际生效范围 ≤ 父级；从 `tenant_members` 删除某 member 后其对成员集合共享文档**立即**不可达（live 校验）；权限查询失败 → fail-closed 503 不降级为可见。
- **A5（S4 AI 读 + 投毒不召回，L3）**：AI 答问带出处；构造跨企业 + intra-org 无权 + pending 未确认草稿 三类投毒文档（含「ignore previous」），在 **L3 真检索栈 + 真 LLM**（禁 mock 召回）下**绝不进 B 的问答上下文**；AI 读端点无 `req.workbenchIdentity` → 拒。**变异**：删投毒/权限前置过滤断言 / 注入「无会话回落服务身份」→ 必须转红。（软断言标软：注入不改变答案走 eval + LLM judge + 人工抽样。）
- **A6（S5 AI 写回 additive + 身份 + schema）**：AI 写回落 `pending` 草稿块、S4 检索**不召回未确认块**；人工确认后才成正文且确认进 db_audit；additive-only（psql 校验非整档 replace）；写回无请求者身份即拒，跨企业/越权写 → 4xx 且目标文档逐字未变；写回内容过 G1 schema 白名单（非白名单节点被拒）。**变异**：注入服务身份回落 / 删 additive 断言 → 必须转红。
- **A7（G2 备份恢复演练，L2）**：从 pg_dump 备份还原到临时库，`documents.content` JSONB + `crdt_state` bytea + 关键字段（org_id/visibility/parent_id/deleted_at）逐条比对一致；演练进 cron 非一次性。
- **A8（路级 windows_cloud 真浏览器 E2E 全链，L3）**：建档→写富文本→存→刷新在→第二人**实时协同字符级合并 + 多人光标**→设「仅自己」→第三人打不开/搜不到/进不了协作→AI 问答带出处→AI 写回 pending 草稿→检索不召回未确认→人工确认。接线三件套：spec 进 workflow 清单 + guard 文件名列表、smoke 进 `smoke-baseline.txt`、聚合进 required check。
- **A9（回归）**：引入 `documents` 到共享知识/检索基建后，路① 既有 CRUD 端点（`knowledge.ts` `POST /entries`/`GET /recent`/`GET /projection`）不回归——路① 既有 smoke 保持全绿（参照 PR#1676「改端点漏查前端消费链致生产回归」教训）。**注**：定义 v1「路①既有经验问答不回归」措辞已按探索实锤更正——路① 现状无问答，回归面是 CRUD 端点与消费链，非问答。

---

## 判定点登记表（J1–J9；REC=所选方法 + 备选 + 依据 + 误判后果）

- **J1 CRDT 库选型**：**REC=Yjs**。备选：Automerge。依据见下「CRDT 库选型对比」。误判后果：选错则 TipTap 绑定/多人光标全部自研，工期翻倍且 merge 正确性风险。
- **J2 WS 握手鉴权方案**：REC=**手写** upgrade 握手，`auth.api.getSession({headers: fromNodeHeaders(upgradeReq.headers)})`→`tenant_members` 真查→memberId+orgId，抄 `agent-ws.ts` 的 `ws` 库 noServer+upgrade+ping 模式但路径 `/collab-ws` 独立、鉴权换 cookie 会话。备选：把 workbenchAuthGuard 硬塞 WS（**否决**——它是 Express 中间件，WS upgrade 不过中间件链，探索实锤）。误判后果：直接复用中间件→握手无鉴权→任意人进任意协作房。
- **J3 CRDT 持久化形态**：REC=`crdt_state bytea`（Yjs update log / 编码后 state）为并发真相 + 派生 ProseMirror JSON 快照写 `documents.content jsonb`（供 S1 导出 / S4 检索抽取 / 权限路径，且 G1 schema 白名单为唯一入库校验）。备选：只存 JSON 快照不存 CRDT state（**否决**——丢失合并历史无法 resync）。误判后果：只存一侧→要么无法实时合并、要么检索/导出拿不到纯文本。
- **J4 三层权限中间层来源**：REC=(b) 显式指定成员集合（不建部门表）。备选：(a) 先两档后刀 /(c) 新建部门表（重）。依据：员工目录只有 org+member 两层（`staff-directory.ts`），无部门层。误判后果：建部门表=重且与飞书组织结构耦合。
- **J5 成员集合生命周期**：REC=命中后 live 校验 member 仍属本 org（查 `tenant_members`），禁只信静态 id 列表。备选：静态列表（**否决**——离职+未失效会话=越权读）。误判后果：陈旧成员集合越权读。
- **J6 检索索引形态与纳入范围**：REC=显式标「可被 AI 检索」才进 + thin 关键词倒排（index 行携带 org_id+effective-visibility，权限过滤前置于召回）；embedding 加厚（需向量库支持 org_id+visibility 元数据 pre-filter）。备选：全部文档进 + 首刀 embedding。误判后果：先召回后过滤→无权标题/片段泄进 LLM。
- **J7 org 声明形态（外部依赖，非本路裁决）**：**待 `active_org` 定案**。现状下限=单 org 成员从会话唯一推 org、多 org 成员 fail-closed 409；WS 连接与 AI 读写的 org 维度形态待 multiorg agent 定案后由 controller 补。误判后果：本路替 multiorg agent 猜 active_org 语义→双方模型冲突。**本条不在本轮拍板，仅登记依赖。**
- **J8 AI 读/写身份来源**：REC=只在请求者本人已鉴权同步 HTTP 请求内、作为服务端工具调用复用 `req.workbenchIdentity`（org 维度待 J7）；禁任何需自带身份的异步/后台 AI 检索或写库。备选：后台 worker 自带服务身份（**否决**——越权召回/写全租户）。误判后果：AI 通道成越权后门。
- **J9 AI 写回确认权归属**：REC=确认权归对该 doc 有编辑权的人类，**不能是投毒植入者自助确认**，确认进 db_audit；确认闸只管「未确认不成正文」，投毒真防线是 G3③ 数据分隔 + S4 未确认不进检索。备选：AI 自确认（**否决**）。误判后果：把确认闸误当投毒防护→植入者自助确认绕过。

---

## CRDT 库选型对比（J1 依据）

| 维度 | **Yjs（REC）** | Automerge |
|---|---|---|
| TipTap/ProseMirror 绑定 | **官方 `y-prosemirror` + TipTap 官方 `@tiptap/extension-collaboration`/`collaboration-cursor`**，字符级合并 + 多人光标近乎开箱；本仓 TipTap 3.x 已是 dashboard 依赖 | `@automerge/prosemirror` 存在但较新、glue 更多，TipTap 无一等扩展 |
| 多人光标/在线态 | **awareness 协议内置**（presence/cursor 开箱） | 需自行搭 presence 通道 |
| 传输/带宽 | 二进制增量 update，紧凑，天然适配 WS noServer 增量广播 | 历史上开销较大，Automerge 2/3 改善 |
| 服务端持久化 | Y.Doc 编码为 update（Uint8Array）→ `bytea`；可派生 ProseMirror JSON 快照 | JSON-like 文档，自带完整历史/time-travel，但存储更重 |
| 与现有 WS 模式契合 | `y-websocket` noServer 模式可挂 `agent-ws.ts` 同款 `ws` 库 upgrade | 传输层需另搭 |
| 成熟度/生态 | 大量协作编辑器实战（成熟） | 较新，Rust 核心 wasm，数据模型更「可检视」 |
| 何时反选 | — | 若首刀就要文档内建全量历史/时间旅行为一等需求，Automerge 更顺 |

---

## NFR 分类（详见合同 `lifelines_and_nfr`；此处列人读摘要）

**lifeline（违反即失败）×8**：① cross-tenant 六层隔离；② intra-org 权限七处前置过滤 fail-closed；③ AI 读/写只在同步请求复用 `req.workbenchIdentity`、禁后台服务身份；④ XSS/SQL（ProseMirror schema 属性协议白名单 + 参数化）；⑤ WS 握手 cookie 会话鉴权 + 每连接 doc 权校验、无鉴权不建房；⑥ 未确认 AI 草稿不进检索（投毒防线）；⑦ 备份 + 恢复演练；⑧ 无静默数据丢失（CRDT 合并零丢字 / 自动保存失败可见）。
**best_effort ×4**：⑨ 检索索引 ACL 收紧后 N 秒一致（越权召回窗口收窄，尽力）；⑩ CRDT 实时延迟/多人光标顺滑；⑪ AI 答案抓要点/出处对（软，eval+judge+抽样）；⑫ TipTap/Yjs 版本锁。

---

## P2 记账（不阻塞，进账本留给实现期）

- 内嵌图片对象存储 + Markdown 导出对图片/@提及有损范围显式声明（tech P2-3）。
- 版本全量回滚（最小档=回看上一版快照；AI 写回确认后撤销挂此加厚，不做清单）。
- 与路① 经验的桥（文档一键沉淀为经验 / 答案分标「经验/文档」来源，Q4，本刀不做）。
- 导出审计 + 限流（导出留 db_audit，防批量拖库）。
- 协作消息注入防护、并发洪峰限流（场景八格已列，实现期定阈值）。
- Notion/飞书批量导入（首刀不含，主理人拍板 Q2，留后续刀）。
