# 微信客服回复引擎重构 — Sprint A 设计（后端引擎）

**日期**：2026-06-04
**Journey**：Path 4 客户私域 AI 接管 — 推进 Step 3（私聊进来 → AI 写草稿）从 thin 加厚到 medium
**范围**：纯后端引擎。不含中台 UI、不含扫微信导入。一个 sprint = 一个 PR。

---

## 1. 背景与问题

现状 `apps/api/src/services/wechat-draft.ts` 的 `generateChatDraft()`：
- **像机器人**：硬编码"亲切专业客服助理" prompt，无人设；`callOpenRouter` 不剥 `<think>`，DeepSeek 思路会漏给客户；无 temperature。
- **没个性**：完全没有 persona 概念。
- **两三句就忘**：对话历史只从飞书"互动记录"读，`.slice(-10)` 取最后 10 轮 + 每条砍 200 字，且飞书查询无排序保证；无短/中/长期分层。

## 2. 核心洞察

模型（DeepSeek via OpenRouter）**本身无记忆**。"记得住"不是模型的事，是我们在每次调用前自己拼好上下文喂进去的事。这一层叫**上下文装配器（context assembler）**，是本 sprint 的核心。

AI 回复喝**三口井**：
| 知识源 | 是什么 | 范围 | Sprint A 数据来源 |
|---|---|---|---|
| ① 人设 Persona | 我怎么说话 | 全局 1 份 | `config/wechat-persona.json` |
| ② 企业知识库 KB | 我的生意是什么（企业/产品/人群/Q&A） | 全局 1 份 | `config/wechat-business-kb.json` |
| ③ 客户记忆 Memory | 我记得这个人什么（短/中/长） | 每联系人 1 套 | Postgres |

> Sprint A 里 ①② 用配置文件喂数据，引擎能读到即可；中台编辑界面 + AI 帮填 A1–A5 是 Sprint B。

## 3. 架构与模块

全部新代码放 `apps/api/src/services/wechat/` 子目录（新建），**互不重叠**，便于并行开发：

```
apps/api/src/services/wechat/
  persona.ts            # ① 人设：加载 + 渲染 SOUL block
  business-kb.ts        # ② 企业知识库：加载 + 关键词检索 + 渲染 block
  contact-memory.ts     # ③ 三层记忆：读写 wechat_messages + wechat_contact_memory + 固化
  context-assembler.ts  # 装配器：把三口井 + 当前消息拼成 {system, user}，带 token 预算
  types.ts              # 共享类型契约（所有模块 import 这里，先定死）
```

改动现有文件（由 lead 集成，团队不碰）：
- `apps/api/src/llm/openrouter.ts`：加 `system` / `temperature` 支持 + `<think>` 剥离
- `apps/api/src/services/wechat-draft.ts`：`generateChatDraft` 接入新引擎
- `apps/api/migrations/`：新建迁移建两张表

### 3.1 共享类型契约 `types.ts`（先定死，所有人对齐）

```ts
export interface Persona {
  self_name: string;            // 我的自称
  address_style: string;        // 怎么称呼客户
  tone: string;                 // 语气基调
  sentence_style: string;       // 句长/拆句偏好
  use_emoji: string;            // emoji 习惯
  banned_phrases: string[];     // 禁用词/禁用腔
  few_shot: { customer: string; me: string }[];
}

export interface BusinessKB {
  company: { name: string; what_we_do: string; value_prop: string; contact: string };
  products: { name: string; selling_points: string; price?: string }[];
  audience_segments: { code: string; label: string; desc: string }[];  // A1..A5
  qa_docs: { q: string; a: string }[];
}
export interface KBHit { kind: 'qa' | 'product'; text: string; score: number }

export type FactCategory = '称呼' | '身份' | '偏好' | '承诺' | '禁忌' | '其他';
export interface ContactFact { category: FactCategory; content: string }

export interface ContactMemory {
  summary: string;              // 中期：滚动摘要
  facts: ContactFact[];         // 长期：稳定事实
}
export type Direction = 'in' | 'out';   // in=客户说, out=我方回
export interface ChatMessage { direction: Direction; content: string; created_at: string }

export interface AssembledContext { system: string; user: string }
```

### 3.2 `persona.ts`

```ts
export function loadPersona(): Persona;          // 读 config，缺文件用内置 DEFAULT_PERSONA
export function renderPersonaBlock(p: Persona): string;  // 生成 system prompt 的人设段
```
- 配置路径：`process.env.WECHAT_PERSONA_PATH || <repo>/config/wechat-persona.json`
- `renderPersonaBlock` 必须输出反-AI 框架：「你就是 {self_name} 本人在用微信聊天，不是客服、不是助理。像真人发微信：口语、短句、可拆多条、该用 emoji 用、**绝不写出思考过程**、绝不用客服腔、绝不用这些词：{banned_phrases}」+ few_shot 示例。

### 3.3 `business-kb.ts`

```ts
export function loadBusinessKB(): BusinessKB;    // 读 config，缺文件用内置空壳
export function retrieveRelevantKB(message: string, kb: BusinessKB, topK?: number): KBHit[];
export function renderKBBlock(kb: BusinessKB, hits: KBHit[]): string;
```
- `retrieveRelevantKB`：thin 阶段用**关键词/子串重叠打分**（不用 embedding），对 qa_docs + products 打分取 topK（默认 3）。命中 0 条返回空数组。
- 配置路径：`process.env.WECHAT_BUSINESS_KB_PATH || <repo>/config/wechat-business-kb.json`
- `renderKBBlock`：始终输出企业基本信息；命中的 Q&A/产品作为「可参考资料」附上，并注明「答产品问题以此为准，没有依据就说去确认，不要编」。

### 3.4 `contact-memory.ts`

```ts
export async function appendMessage(contactKey: string, senderName: string, direction: Direction, content: string): Promise<void>;
export async function getShortTerm(contactKey: string, limit?: number): Promise<ChatMessage[]>;   // 按 created_at ASC，默认 12 条
export async function getContactMemory(contactKey: string): Promise<ContactMemory>;               // 无记录返回 {summary:'', facts:[]}
export async function consolidate(contactKey: string, opts?: { force?: boolean }): Promise<void>;  // 固化
```
- **短期**：`wechat_messages` 原文逐条，**不再砍 200 字**。
- **固化 `consolidate`**：未固化消息数 ≥ 阈值（`WECHAT_CONSOLIDATE_THRESHOLD`，默认 8）或 `force` 时触发：
  1. 读该联系人未固化消息 + 现有 summary/facts
  2. 调一次 `callOpenRouter`（JSON 输出）：`{ "summary": "...", "facts": [{category,content}...] }`
  3. 合并：summary 覆盖更新；facts 按 (category+content) 去重合并
  4. `UPDATE wechat_contact_memory`，被固化消息标 `consolidated=true`
  5. 解析失败/LLM 失败 → 静默跳过（不抛，不阻塞回复）
- **facts 同步飞书（Sprint A 范围内只做单向 push，env 门控，默认关）**：`WECHAT_FEISHU_FACTS_SYNC=1` 时把 facts 推一张飞书表给人看；**读回人工编辑（飞书优先）放到 Sprint C 中台页**。Sprint A 引擎读 facts 以 DB 为准。
- DB 失败一律 `console.warn` 不抛（与现有 wechat-draft 容错风格一致）。

### 3.5 `context-assembler.ts`

```ts
export function assembleChatContext(input: {
  message: string;
  persona: Persona;
  kb: BusinessKB;
  kbHits: KBHit[];
  shortTerm: ChatMessage[];
  memory: ContactMemory;
  maxChars?: number;            // 预算，默认 6000
}): AssembledContext;
```
- 纯函数（无 IO），完全可单测。
- `system` = 人设 block + KB 企业信息/资料 block。
- `user` 顺序：`[长期事实] → [中期摘要] → [最近对话原文] → [客户最新消息]`。
- **token 预算**：优先级 长期事实 > 最近原文 > 中期摘要。超 `maxChars` 时先砍中期摘要，再从最旧的短期原文开始砍；长期事实和「客户最新消息」永不砍。

### 3.6 `openrouter.ts` 改动（lead 做）

- `CallOpenRouterArgs` 加可选 `system?: string`、`temperature?: number`。
- 有 `system` 时 messages = `[{role:'system',...},{role:'user',...}]`，否则维持单 user。
- 有 `temperature` 时写进 body。
- 新增并导出 `export function stripThinking(text: string): string`：移除 `<think>...</think>`（含未闭合到结尾的）、移除开头「思考：/分析：/让我想想」之类前缀，trim。**`callOpenRouter` 返回前对 content 调用 `stripThinking`**（think 块任何场景都不该要）。
- 保留现有 `OPENROUTER_FORCE_5XX` / CI maxTokens cap / llm_audit 写入逻辑不变。

### 3.7 `wechat-draft.ts` 集成（lead 做）

`generateChatDraft` 改造（保留白名单校验 + 飞书"互动记录"审批台写入 + DB `wechat_publish_task` 写入**全部不动**，只换"怎么生成 aiContent"）：
1. `contactKey = wechat_id || sender`
2. `await appendMessage(contactKey, sender, 'in', content)`
3. 并行 load：`loadPersona()`、`loadBusinessKB()`、`getShortTerm(contactKey)`、`getContactMemory(contactKey)`
4. `kbHits = retrieveRelevantKB(content, kb)`
5. `{system, user} = assembleChatContext({...})`
6. `callOpenRouter({ system, prompt: user, temperature: 0.8, model:'deepseek/deepseek-chat', purpose:'wechat_chat_draft' })`
7. aiContent = 结果（已被 stripThinking）；再过一遍 persona.banned_phrases 清理
8. 成功后 `await appendMessage(contactKey, sender, 'out', aiContent)`
9. 触发 `consolidate(contactKey)`（await，但内部容错不抛）
10. 之后原样写飞书审批台 + DB

> `generateMomentDraft`（朋友圈）本 sprint **不改**。

## 4. 数据库 schema（新迁移）

迁移文件放 `apps/api/migrations/`，命名与编号**沿用现有迁移约定**（开发者先看最近一个迁移文件确认 schema 前缀/序号/格式）。

```sql
CREATE TABLE IF NOT EXISTS wechat_messages (
  id            BIGSERIAL PRIMARY KEY,
  contact_key   TEXT NOT NULL,
  sender_name   TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  content       TEXT NOT NULL,
  consolidated  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wechat_messages_contact_time
  ON wechat_messages (contact_key, created_at);

CREATE TABLE IF NOT EXISTS wechat_contact_memory (
  contact_key          TEXT PRIMARY KEY,
  sender_name          TEXT,
  summary              TEXT NOT NULL DEFAULT '',
  facts                JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_consolidated_at TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
（若现有表都在 `zenithjoy.` schema 下，则加前缀对齐。`wechat_publish_task` 当前无前缀，以最近迁移为准。）

## 5. 测试（E2E-first，CI 强制先写测试再写实现）

提交顺序必须满足 CI 的 `lint-tdd-commit-order` + `lint-feature-has-smoke`：

- **commit 1（Red）**：失败的 E2E mock 测试 + smoke.sh 占位（≥5 行实质）+ 纯函数单测骨架。
- **commit 2+（Green）**：实现 + 单测填满。

### 5.1 主 E2E mock：`apps/api/tests/e2e/wechat-cs-engine.e2e.test.ts`（vitest）
mock 掉 `global.fetch`（OpenRouter），跑多轮 `generateChatDraft`，断言：
1. **风格净化**：mock 返回带 `<think>客户在催，先稳住</think>好嘞马上安排😊` + 含禁用词 → 最终 aiContent 无 `<think>`、无禁用词。
2. **跨轮长期记忆**：第 1 轮 inbound「我对花生过敏」→ 触发 force consolidate 抽出 fact → 第 5 轮再调用时，断言传给 `callOpenRouter` 的 **prompt/system 里带着「花生 / 过敏」这条长期事实**（用 fetch mock 捕获请求体校验）。
3. **三层落库**：断言 `wechat_messages` 有 in/out 记录、`wechat_contact_memory` 有 summary/facts。
4. **三口井**：断言喂给模型的内容同时含 人设(self_name) + KB(企业名或命中 Q&A) + 客户记忆。

> DB 依赖：复用现有 `vitest.integration.config.ts` 的测试库连接方式（开发者先确认本地/CI 如何起测试 Postgres；若无则用 docker 起一个一次性 pg）。assembler / persona / business-kb / stripThinking 的**纯函数单测无需 DB**，必须先全绿。

### 5.2 CI smoke：`.github/workflows/scripts/smoke/wechat-cs-engine-smoke.sh`
真链路：起 API → POST `/api/wechat/draft-generate`（mode=review）多轮 → `psql` 查 `wechat_messages` / `wechat_contact_memory` 有记录 → 校验返回 ok。复用现有 path4 smoke 的起服务/造数据套路。

## 6. 范围边界（明确不做）
- ❌ 中台任何 UI / 客户列表页 / 知识库编辑页（Sprint B/C）
- ❌ 扫微信近 7 天导入 + 自动分级（Sprint D）
- ❌ facts 飞书读回（人工编辑优先）—— Sprint C 随编辑 UI 一起
- ❌ embedding 语义检索 —— thin 用关键词，有证据再加厚
- ❌ 拆多条短消息真发 —— 涉及 RPA 发送端，本 sprint 不动
- ❌ `generateMomentDraft` 改动

## 7. 团队分工（lead 协调，各人只碰自己的新文件）
- **agent-schema**：第 4 节迁移 + 跑通本地迁移；产出 `wechat_messages` / `wechat_contact_memory`。
- **agent-knowledge**：`persona.ts` + `business-kb.ts` + 两个 `config/*.json` 示例 + 它们的纯函数单测。
- **agent-memory**：`contact-memory.ts`（依赖 agent-schema 的表）+ 单测（mock pool）。
- **agent-assembler**：`context-assembler.ts` + `types.ts`（types 最先产出给全员）+ assembler 纯函数单测。
- **lead（我）**：`openrouter.ts` 改造 + `wechat-draft.ts` 集成 + E2E mock 测试 + smoke.sh + 整合跑绿。
```
