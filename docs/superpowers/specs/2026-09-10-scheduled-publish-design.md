# 作品定时发送（scheduled_at）设计

日期：2026-09-10 · 分支：cp-09100824-scheduled-publish · Brain task：b125fac7 · 决策：作品定时发送（small-change）

## 目标

主理人/客户在编排台（Notion/飞书）给作品填一个「定时」时间；状态改「发」后，编排 worker 到点才派单，未到点每轮跳过。不填「定时」= 现行为（立即派），零破坏。

## 现状锚定（研究结论）

- 派单触发不在 DB：`notion-orchestrator.ts pullFireRows`（:151）用 Notion filter `状态==发` 拉行；`feishu-orchestrator.ts`（:166）同构走 Bitable search。`publish-rollup` 不派单只收敛终态。
- `NotionProperty` 形状（notion-orchestrator.ts:40-44）只有 title/rich_text/multi_select，无 date；飞书 Bitable 日期字段值是毫秒时间戳 number，两侧读 date 均无先例。
- contents 无 `scheduled_at` 列；`PATCH /api/contents/:id`（publish-dispatch.ts:256-267）为手写 if 分支拼 setClauses；`GET /` SELECT 列写死（:141）。

## 设计

### 1. migration：`contents.scheduled_at TIMESTAMPTZ NULL`

`apps/api/db/migrations/20260910_083000_contents_scheduled_at.sql`，幂等、无 BEGIN/COMMIT，含 COMMENT（NULL=立即）。不加索引——判定不走 DB 扫描（见下）。

### 2. notion-orchestrator 拉发方向加定时闸

`pullFireRows` 对每行新增：读「定时」date 属性（`NotionProperty` 扩 `date?: { start?: string }`，新 helper `parseScheduledAt`）：

- 无「定时」属性或值为空 → 立即派（现行为）。
- 有值且 `start <= now` → 派；回写 contents 时一并 `scheduled_at = <值>`（镜像进 DB 供列表/审计）。
- 有值且 `start > now` → 本轮跳过：不回写、不派、Notion 行留在「发」，仅 debug 日志。60s 轮询天然构成到点检查循环。
- **解析失败（非法日期）→ fail-closed：跳过 + 红日志 `[notion-orchestrator] 定时解析失败`，宁可不发不误发。**

时区语义：Notion date 只填日期不填时间时按 UTC 0 点（沪 8 点）处理，`new Date(start)` 原样解释；带时间则自带偏移。

### 3. feishu-orchestrator 同构

「定时」字段为毫秒时间戳 number（Bitable 日期原生形态）；`FeishuRecordFields` 扩 number 形态。判定逻辑与 Notion 侧同一套语义（到点/未到/空/坏值 fail-closed）。

### 4. HTTP 端点透出

- `PATCH /api/contents/:id`：加第 4 个 if 分支 `scheduled_at`（接受 ISO 字符串或 null；`isNaN(Date.parse())` → 400 INVALID_SCHEDULED_AT）。沿用现有 CAS（queued 后 EDIT_LOCKED）。
- `GET /api/contents`：SELECT 列与响应体补 `scheduled_at`。

### 5. 不做（YAGNI）

- 无锚作品（纯 API/小程序直发）的 DB 侧到点派发 worker——现在没有任何入口能给无锚作品设定时，留给模式③（小程序直发页）一刀一起做。
- rollup、dispatchContentPublish 零改动（service 不管时机）。
- 编排台加「定时」列属于运维动作（Notion date 属性 + 飞书日期字段），PR 合并后执行，不进代码。

## 错误路径汇总

| 场景 | 行为 |
|---|---|
| 定时值非法/解析失败 | 跳过不派 + 红日志（fail-closed） |
| 定时已过很久（补发场景） | `start <= now` 成立 → 正常派（语义=到点后尽快） |
| worker 宕机跨过时点 | 重启后下一轮即派（判定是 `<= now` 非 `== now`） |
| PATCH 传坏时间 | 400 INVALID_SCHEDULED_AT |

## 测试策略（unit 档，全 mock，沿用现有风格）

- `notion-orchestrator.test.ts` 新增 3 例：未到点不派（dispatch 不被调、不回写）/ 到点派（dispatch 被调 + UPDATE 含 scheduled_at）/ 无定时立即派（回归）。+1 例：坏日期 fail-closed 不派。
- `feishu-orchestrator.test.ts` 同构 4 例（毫秒时间戳形态）。
- `publish-dispatch.test.ts`：PATCH scheduled_at 合法写入 / 非法 400。
- test-registry：三个测试文件已登记（同文件加用例无需新条目），note 顺手补一句定时语义。
- smoke：`notion-orchestrator-selfcheck-smoke.sh`（GP customer_first_success 已锚）加一关：断言 contents 表含 scheduled_at 列（迁移生效验证），满足 GP-Anchor 触碰要求。

## 验收

- [ ] commit-1：failing tests（上述用例，先红）
- [ ] commit-2：migration + 实现，tests 转绿
- [ ] smoke 关卡就位，CI 全绿
- [ ] staging 真验：Notion 建一行定时 now+2min，状态改「发」，观察 60s 轮询两轮内不派、到点后自动派出并回执
