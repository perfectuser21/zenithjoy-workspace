# PrepPRD：工厂 · F1 开发闭环 — GP锚定闭环 刀2（lint-gp-anchor.sh CI硬闸）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：lint-gp-anchor.sh 新写 + 挂进 ci-l1-process.yml（三处挂载）+ PR 模板新建 + golden-path-f1-anchor-smoke.sh 追加断言 + 设计文档字段名 bug 修正
- [ ] 另立 Sprint（本次不做）：刀3（skill层接线）、刀4（Brain层锚校验+evaluator判据）、刀5（patrol棘轮+历史归户）
- [ ] 待讨论：无——本轮 FR-GAN 挖出的分歧点（jq vs node+lib.mjs 方案）已用真实 CI 耗时数据（`Test — Deploy Lib` job 实测101s）收敛为 jq 方案，不需要用户拍板

## Journey 当前状态
- Journey：工厂 · F1 开发闭环（`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，maturity=mvp）
- ✅ GP锚定校验（97400e37...）— feature/thin，刀1已交付 product-map SSOT 地基
- 🔄 本次刀2推进同一 Ability

## 本次要做的
把刀1建好的 product-map SSOT 数据地基，接上真正的机械执行闸：PR body 必须含合法的 `GP-Anchor:` 声明，否则 CI 红，不能合并。这是设计文档七道防线里唯一"不受LLM漂移影响"的一环。

## Golden Path（开发者/AI-agent 操作流程）

1. 开发者/AI 提交 PR，body 里写恰好一行 `GP-Anchor:` 声明（三种合法形态之一）→ `lint-gp-anchor.sh` 用 `jq` 读取本 PR 分支已提交的 `product-map/generated/product-map.json`（不装 node/npm ci，维持 L1 秒级门禁设计）解析该行 → 恰好一行则继续，零行或多行直接判红（多行不静默取first/last）
2. 若为推进型 `line02/customer_smart_acquisition#step7` → 校验 `line_id/gp_id` 组合真实存在于 JSON 的 `golden_paths` 数组 → 存在则继续；不存在则报错：先给 line 级简表（按 app_id/line_id 分组现算），再提示 `npm run product-map:check` 看完整清单
3. 若为推进型 → `git diff --name-only origin/main...HEAD` 取本 PR 完整变更文件列表 → 列表须包含该 GP 的 `smoke_files` 数组里的至少一个路径 → 触碰则 PASS；未触碰则报错列出该 GP 应该触碰的具体路径
4. 若为 `keep-green` 型 → 只校验 line/gp id 存在，不查 diff（nightly ci-patrol 兜底核实是否真的绿，本刀不覆盖，设计留白）
5. 若为 `none(类别)` 型 → 类别须在白名单 `infra|docs|config|backlog` 内；`none(backlog)` 只做纯格式正则校验 body 里带一个类 issue-id 的 token（**不**真调 Brain API——GitHub Actions 云 runner 够不到 `localhost:5221`，这是硬约束不是选择）
6. 全部通过 → job 绿灯；job 挂进 `ci-l1-process.yml` 的 `l1-passed` 聚合 gate（job 定义 + `needs` 数组 + 内部 `if` 判断块，三处缺一漏掉即"跑了但不真正拦PR"）→ PR 可合并
7.（配套）新建 `.github/pull_request_template.md`，含 `GP-Anchor: ` 起始行提示 + 三形态示例，降低填写门槛
8.（配套）设计文档第3节字段名 `smoke_file`（单数，文档bug）同步修正为刀1已落地的真实字段名 `smoke_files`（复数数组）

### 错误路径
- Step1-失败：body 为空/没有任何 `GP-Anchor:` 行 → 报错含三种合法形态示例 + PR模板提示引用
- Step1-失败：出现 2 行及以上 `GP-Anchor:` 声明 → 明确报错"只允许恰好一行"，不猜测取哪一行
- Step2-失败：id 写错（大小写/连字符）→ 本刀只给全量 line 级简表，不做模糊匹配纠错建议（体验优化留后续）
- 环境类失败：`product-map/generated/product-map.json` 本身 JSON 解析失败（文件损坏/被误删）→ 脚本自身 try/catch 转成 `::error::GP-ANCHOR-ENV-FAIL`，与"业务判定失败"区分开，不裸崩栈
- PR_BODY 含反引号/`$()`/超长文本 → 通过 `env:` 注入 + 写临时文件读取，不在 `run:` 里字符串插值，避免 shell 注入

## 客户视角
无终端客户可感知变化，"客户"是提交 PR 的开发者/AI-agent（dev_pipeline 内部机制，同刀1）。

## 完成后开发者/AI能
1. PR body 不写合法 `GP-Anchor:` 声明，CI 直接红，无法合并（机械硬闸，不是审查提醒）
2. 声称推进某 GP 步骤但没有真的碰对应 smoke_files，CI 直接红
3. 10 秒内从报错信息定位到该怎么改（三种合法形态示例 + line 级简表 + 完整清单命令）

## 涉及的 Ability / Feature
- GP锚定校验（GP-Anchor Enforcement，97400e37...）— 推进，thin（本刀不升级thickness，闸门本身是thin骨架的自然延伸）

## 不包含
- skill 层接线（/dev入口检查、6问第1问、contract模板必填段） — 刀3
- Brain tasks API 锚校验、evaluator PASS判据、report回写 — 刀4
- ci-patrol棘轮、历史无锚PR归户 — 刀5
- `keep-green` 声明的真实性核实（是否真的绿）— 设计留白，推给刀5 nightly patrol
- GP id 拼写错误的模糊匹配/纠错建议 — 体验优化，非阻塞需求
- Brain issue id 格式的真实性校验（backlog类）— 只做格式正则，不真调API（GHA网络不可达是硬约束）
- shellcheck 校验新脚本 — 核实为不存在的仓库惯例（Challenger验证），不新增

## 判定点登记表
（本任务无接缝判定点，N/A——纯CI脚本+静态数据校验，无对真实世界模糊状态的判断假设）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 不涉及

### API 与凭据
- [x] 不涉及外部API（Brain API显式不调用）

### E2E 测试账号
- [x] 不涉及

### 测试 Fixture
- [x] 用仓库内真实 `product-map/generated/product-map.json`（已确认tracked）做正向fixture；构造虚构PR body字符串做负向fixture

### 基础设施
- [x] `jq`：ubuntu-latest runner 预装，仓库内 `audit-gate.sh` 已在用，本地开发机需确认已装（`which jq`）
- [x] Brain API `localhost:5221` 已确认可用（本次会话已验证，仅用于Brain task registration，不用于lint脚本本身）

## 验收标准（Final E2E）
- [ ] 故意造一个无 `GP-Anchor:` 行的 PR body → lint 必须判红（proven-to-fire）
- [ ] 故意造一个含 2 行 `GP-Anchor:` 声明的 PR body → 必须判红
- [ ] 故意造一个引用不存在 line/gp id 的推进声明 → 必须判红且报错含line级简表
- [ ] 故意造一个推进声明但 diff 未触碰对应 smoke_files → 必须判红
- [ ] 合法的推进/keep-green/none(各4类白名单) 声明样例 → 必须判绿
- [ ] `ci-l1-process.yml` 的 `l1-passed` 聚合 gate 三处挂载点（job定义/needs/if判断）全部到位
- [ ] `golden-path-f1-anchor-smoke.sh`（刀1文件）新增本刀断言后仍整体通过，未新建平行smoke文件
- [ ] `.github/pull_request_template.md` 新建且含GP-Anchor提示
- [ ] 本刀自身PR的body写`GP-Anchor: line00/gp_anchor_enforcement#step2`且真实触碰golden-path-f1-anchor-smoke.sh（自举验收）
- [ ] CI 全绿
