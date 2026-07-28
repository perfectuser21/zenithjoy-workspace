# GP 锚定闭环（GP-Anchor Enforcement）设计

- 日期：2026-07-28
- 状态：已拍板（方案 B 四层闭环 + 一律硬闸，扩展为全周期七道防线）
- 挂载：工厂 · F1 开发闭环（Brain journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`）
- product-map 锚点：`line00/gp_anchor_enforcement`（本设计落地时由刀 1 注册）

## 1. 问题

对最近 40 个合并 PR 的抽样分析：约一半 PR body 完全没有 Path/smoke 声明，是典型单点修复（staff-hub 飞书登录链路 7 个 PR 连环修是代表）。铁律 1「每个 PR 必须声明推进哪条 Path 的哪个 Step」只是 PR 描述里的自觉声明，无机械执行，形同虚设。修完的东西不挂在任何 golden path 上，下一轮排期被忽略、被后续改动破坏而不自知——孤儿 PR。

### 三层剖析

1. **表层**：PR body 没写 Path 声明。只强制写声明会沦为八股文（#1487 写了 Path4 但没碰任何 smoke，无人验证）。
2. **中层**：锚是自由文本，机器无法校验。#1486 已建成 `product-map/product-map.yaml` 机器可验证 SSOT（含 `npm run product-map:check` 漂移检测 + CI `product-map-contract` job），结构化锚点的地基已存在，但没有任何东西挂上去。
3. **深层（闭环断裂）**：`golden_paths` 段只有 staff_app/line00 的 3 条 GP，三条客户线 line01/line02/line04 的 GP 为空。Path 1/2/4 的步骤定义只活在 `.claude/CLAUDE.md`（违反 product-map README「不允许在 CLAUDE.md 手写分类」）。今天上「PR 必挂 GP id」的 lint，客户线 PR 无锚可挂，lint 一天内被绕过或关掉。孤儿的根因链：修复→没回流 smoke（铁律 5）→ smoke 没注册到 GP → GP 没进 SSOT。
4. **来源数据**：裸奔 PR 几乎全是交互式会话产物（未走 harness）。只在 harness 或只在 CI 防都有死角，防线必须沿任务全生命周期铺。

## 2. 设计总览：全周期七道防线

任务生命周期：出生（Brain 注册）→ 规划（/dev + 6问）→ 合同（proposer/reviewer）→ 执行（generator 写 PR）→ 验收（evaluator/judge）→ 合并（CI）→ 事后（patrol/report）。

| # | 环节 | 防什么 | 改动 |
|---|---|---|---|
| ① | Brain 任务注册 | 孤儿的出生 | `tasks` 注册 API 必填 `gp_anchor`（GP id 或 `none(类别)`），无锚创建 400；tick 不派无锚任务 |
| ② | /dev skill 入口 | 交互式死角（最大孤儿来源） | Stage 0 加锚点检查：从 task/上下文取锚 → 查 `product-map/generated/product-map.json` 验证存在；无锚 → 先定锚或归 backlog，不开工。Hook 已强制改代码走 /dev，此处是交互式路径咽喉 |
| ③ | harness-planner 6问 | 规划期糊弄 | 第 1 问从 prose+Notion URL 升级为机器可查的 GP id，查无此锚 = 6问不通过 |
| ④ | contract proposer/reviewer | 合同期漂移 | contract 模板加 GP-Anchor 必填段；reviewer 清单加「锚真实存在、推进声明可被 smoke 验证」 |
| ⑤ | harness-evaluator | 执行期货不对板 | PASS 判据加「PR body 的 GP-Anchor 与 contract 声明一致」 |
| ⑥ | CI lint | 一切漏网（唯一不受 LLM 漂移影响的机械硬闸） | `lint-gp-anchor.sh` 格式+id 存在性硬闸；推进声明查 smoke diff |
| ⑦ | ci-patrol + harness-report | 事后腐烂 | patrol 棘轮盯「keep-green 却红」与「GP 步骤无 smoke 覆盖」；report 回写 PR↔GP 关联进 `journey_features` |

**分层哲学**：②③④⑤ 是 skill/LLM 层，防**浪费**（孤儿任务在第 0 步死掉，不烧完整个 pipeline 才死在 CI），但 skill 是提示词、会漂移，不能是唯一防线；⑥ CI 是唯一机械硬闸，兜住一切；① 是数据层，锚从出生随任务流转，后面各层只做传递与核验；⑦ 管合并之后的腐烂。

## 3. GP-Anchor 声明规范

PR body 必须含一行机器可读声明，三种形态：

```
GP-Anchor: line02/customer_smart_acquisition#step7    ← 推进某业务步骤
GP-Anchor: line02/customer_smart_acquisition keep-green  ← 不推进但保持全绿
GP-Anchor: none(infra)                                ← 显式豁免
```

- 豁免类别白名单固定：`infra` / `docs` / `config` / `backlog`。**没有 hotfix/紧急类**——所有修复都会自称紧急，紧急修复写一行声明的成本是 10 秒。
- `none(backlog)` 必须在 body 里带 Brain issue id，防止 backlog 变垃圾桶。
- 校验依据：`product-map/generated/product-map.json`（line id、GP id 必须真实存在）。

## 4. product-map 扩展（刀 1）

- `golden_paths` 补三条客户线 GP：`customer_first_success`（line01，6 步）、`customer_smart_acquisition`（line02，8 步）、`customer_private_ai`（line04，6 步），步骤从 `.claude/CLAUDE.md` 迁移。
- schema 加两字段：`steps`（`id`+`name` 业务步骤清单）、`smoke_file`（`golden-path-N-smoke.sh` 仓库相对路径）。`product-map-contract` job 校验 `smoke_file` 存在——GP 无 smoke 注册不进去，本身即准入闸。
- CLAUDE.md 步骤清单改为指向 product-map 的引用，消除双写。
- **business step ≠ smoke step**：Path2 业务 8 步 vs smoke 11 步，不强行对齐。product-map 记业务步骤；smoke 内部步数是实现细节。验证只到「碰没碰 smoke_file」粒度（YAGNI，step 粒度标记留待有真实需要）。

## 5. 排刀

| 刀 | 内容 | 依赖 |
|---|---|---|
| 刀 1 | GP 迁入 product-map SSOT + schema 扩展 + 注册 `line00/gp_anchor_enforcement` 自身 + `golden-path-f1-anchor-smoke.sh` | 无（地基） |
| 刀 2 | `lint-gp-anchor.sh` CI 硬闸（挂 `ci-l1-process.yml`）+ PR 模板 | 刀 1 |
| 刀 3 | skill 层三处接线（/dev 入口 + 6问第1问 + contract 模板/审查清单） | 刀 1（与刀 2/4 并行） |
| 刀 4 | Brain 层（tasks API 锚校验 + evaluator 判据 + report 回写） | 刀 1（与刀 2/3 并行） |
| 刀 5 | patrol 棘轮 + 历史无锚 PR 归户（staff-hub 7 连修等归 line00，欠回流 smoke 的开 Issue） | 刀 2 |

### 自吃狗粮与 bootstrap 顺序

- 五把刀任务全注册到 F1 journey（`e6f803f2`）下，6 问第 1 问填「工厂 · F1 开发闭环」。
- 刀 1 落地前 GP 未注册、闸未通电：刀 1 的 PR 用现行 prose 声明（它自己就是注册锚点的 PR）。刀 2 合并起，刀 3/4/5 的 PR 必须过自己建的闸——机制上线的过程即其第一轮真机验收。
- `golden-path-f1-anchor-smoke.sh` 按「守卫必须变异测试」原则写：喂无锚 PR body 给 lint 必须红；喂合法声明必须绿；Brain API 注册无锚任务必须 400。守卫本身被 smoke 持续验证。

## 6. 非目标

- 不做 step 粒度的 smoke 断言映射（只验文件级触碰）。
- 不做 hotfix 旁路与事后清算机制（拍板：一律硬闸）。
- 不在本设计内对齐 Path2 业务步骤与 smoke 步数的编号。
- 不迁移历史 PR 的 git 记录，只做归户台账 + 欠债 Issue。

## 7. 验收标准（整体）

1. 无 GP-Anchor 行（或 id 查无）的 PR 无法合并（CI 红）。
2. 声称 `#stepN` 推进但 diff 未触碰对应 `smoke_file` 的 PR 无法合并。
3. 无锚任务无法注册进 Brain（400），tick 不派发。
4. `npm run product-map:check` PASS 且三条客户线 GP 带 steps + smoke_file。
5. `golden-path-f1-anchor-smoke.sh` 的变异测试（无锚样例必须被拦）在 CI 常绿。
6. ci-patrol 日报出现「GP 无 smoke 覆盖步骤数」棘轮指标。
