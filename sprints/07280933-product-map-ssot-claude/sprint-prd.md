# Sprint PRD: Product Map SSOT — Claude Code 实施计划

**Sprint ID:** 9130f0be-8e8d-4cc5-96f5-7a5313804496  
**Sprint Dir:** `sprints/07280933-product-map-ssot-claude`  
**生成时间:** 2026-07-28  
**类型:** infrastructure  
**目标环境:** github_actions + local_node  

---

## 1. 目标 (Goal)

在 ZenithJoy 仓库中建立**版本化、机器可验证的 Product Map**，作为 App → Line → Golden Path 分类体系的唯一真实来源（SSOT）。Codex 和 Claude Code 均从同一份生成投影消费产品事实；CI L2 Job 持续执行合同约束。

**本 Sprint 是 `sprints/07280817-staff-ability-acceptance/prep-prd.md` 的 Phase 0A。**

---

## 2. 范围边界 (Scope Boundary)

### 本 Sprint 交付

| 交付物 | 描述 |
|--------|------|
| `product-map/product-map.yaml` | 唯一手写产品分类源文件 |
| `product-map/product-map.schema.json` | JSON Schema 结构约束 |
| `product-map/generated/product-map.json` | 确定性规范机器投影 |
| `product-map/generated/product-map.md` | 确定性可读投影 |
| `product-map/README.md` | 所有权、变更流程、GP 边界规则 |
| `scripts/product-map/lib.mjs` | 解析、验证、规范化、摘要、渲染 |
| `scripts/product-map/cli.mjs` | `validate` / `generate` / `check` CLI |
| `scripts/product-map/__tests__/product-map.test.js` | 7 个契约测试 |
| `AGENTS.md` | Thin Codex bootstrap（不含产品事实） |
| `.claude/CLAUDE.md` | Thin Claude Code bootstrap（不含产品事实） |
| `DEFINITION.md` | Thin 遗留指针（移除过时的手写架构事实） |
| `docs/engineering/agent-policy.md` | Provider 中立工程策略 |
| `test-registry.yaml` (修改) | 注册新测试文件 |
| `.github/workflows/ci-l2-consistency.yml` (修改) | 追加 always-on Product Map Job |

### 本 Sprint 明确不交付

- Cecelia Brain 投影 / Product Map API
- Cecelia MIXED Context Bundle 快照复用
- Staff Hub Ability Acceptance 页面、数据库表、API
- Harness 自动验收生成
- Line 01/02/04 客户侧未确认 Golden Path

---

## 3. 已确认种子分类 (Confirmed Taxonomy Seed)

```
customer_app / 客户 App
├── line01 / 智能发布
├── line02 / 智能获客
└── line04 / 私域客服

staff_app / 员工 App
└── line00 / 员工运营中枢
    ├── skill_acceptance  (status: active)
    ├── ability_acceptance (status: proposed — 已批准概念，UI/API 未实施)
    └── line_health       (status: active)

Surfaces: web, api, android, windows
Editions: personal_wechat, wecom
```

> Web/Android/Windows/API 是 Surface，不是 Line。personal_wechat/wecom 是 Edition，不是 Line。Line 01/02/04 暂无正式批准的 Golden Path 条目。

---

## 4. 技术栈

- Node.js 20 ESM
- `yaml@^2.8.1`（解析 YAML 源文件）
- `ajv@^8.17.1` + `ajv-formats@^3.0.1`（JSON Schema 校验含 date 格式）
- `node:test`（内置测试运行器，无框架依赖）
- GitHub Actions（L2 CI Job）

---

## 5. 功能需求 (Functional Requirements)

### FR-01: 产品分类创作合同（Task 1）
- 创建 `product-map/product-map.schema.json`，使用 JSON Schema draft/2020-12
- 创建 `product-map/product-map.yaml` 包含上述确认种子
- 实现 `scripts/product-map/lib.mjs`，导出 `loadAndValidateProductMap`（返回 `{map, errors}`）
- 写失败 E2E 测试（RED），实现后转绿（GREEN）

### FR-02: 交叉引用与唯一性不变量（Task 2）
- `lib.mjs` 追加 `validateRelations(map)` 函数
- 校验：duplicate app/line/gp ID、GP 引用不存在的 app/line/surface/edition
- 每条错误返回可操作的字符串消息
- 关系校验在 schema 验证通过后才执行

### FR-03: 确定性投影与漂移检测（Task 3）
- `lib.mjs` 追加 `canonicalize`、`canonicalJson`、`productMapDigest`、`renderProductMapMarkdown`
- 创建 `scripts/product-map/cli.mjs`，支持 `validate` / `generate` / `check` 三个子命令
- `check` 模式：检测 generated 文件与当前 YAML 是否漂移，漂移时 exit 1
- 生成的 JSON 和 Markdown 均包含相同 SHA-256 摘要
- `product-map:generate` 幂等（运行两次 git diff 无变化）
- root `package.json` 追加 4 个 npm scripts

### FR-04: Provider Bootstrap 收敛（Task 4）
- 创建 `AGENTS.md`（Codex bootstrap，不含任何产品事实）
- 替换 `.claude/CLAUDE.md`（不含任何产品事实，指向生成投影）
- 替换 `DEFINITION.md`（不含任何产品事实，指向生成投影）
- 创建 `docs/engineering/agent-policy.md`
- `lib.mjs` 追加 `assertBootstrapParity(map, documents)` — 扫描 bootstrap 文件中的 App/Line/GP 名称和 ID，发现即报错
- 3 个 bootstrap 文件均包含 `product-map/generated/product-map.md` 指针和 `npm run product-map:check` 指令

### FR-05: 贡献者指南与 GP 边界规则（Task 5）
- 创建 `product-map/README.md`
- 包含：所有权、变更工作流（7 步）、GP 准入规则（3 个必要条件）
- Surface vs Line 区分、Edition vs Line 区分明确写入
- 文档契约测试：7 个 `assert.match` 断言

### FR-06: 始终运行的 CI Gate 和测试注册（Task 6）
- `test-registry.yaml` 追加 `product-map-contract` 条目（type: unit, ci: L2, status: active）
- `test-registry.yaml` 根字段 `updated` 更新为 `2026-07-28`
- `.github/workflows/ci-l2-consistency.yml` 追加 `product-map-contract` Job
  - 无 `paths` 过滤器（每次 push/PR/merge_group 必跑）
  - `npm ci` + `npm run test:product-map` + `npm run product-map:check`
  - timeout-minutes: 5

---

## 6. 验收标准 / Harness Definition of Done

以下 12 条必须在 Harness Report 中有证据：

1. `product-map.yaml` 是唯一手写分类来源
2. 精确解析两个 App：`customer_app` 和 `staff_app`
3. `customer_app` 拥有 Line 01/02/04；`staff_app` 拥有 Line 00
4. `staff_app/line00` 解析 3 个已确认 GP（`skill_acceptance`/`ability_acceptance`/`line_health`）
5. Line 01/02/04 不含虚构的正式 GP 条目
6. Web/Android/Windows/API 验证为 Surface；personal_wechat/wecom 验证为 Edition
7. 无效的 App/Line/Surface/Edition 引用产生可操作错误消息
8. 规范 JSON 和 Markdown 携带一个确定性摘要；`check` 检测漂移
9. Codex、Claude Code、遗留 definition 均指向相同生成投影，不含任何复制的分类
10. Product Map Job 在 L2 workflow 中无 paths 过滤器运行
11. 全部测试通过（7 个）、生成文件为当前状态、实现分支干净
12. 本 PR 不含 Brain、MIXED、Staff Hub UI、验收持久化或自动生成实现

---

## 7. 非功能需求 (NFR)

- **确定性：** 给定相同 YAML 输入，生成的 JSON 和 Markdown 字节级幂等（键排序规范化，SHA-256 摘要）
- **速度：** `npm run test:product-map` 在 CI 中 < 60 秒（无外部 I/O，纯本地文件操作）
- **严格模式：** Ajv 使用 `{ allErrors: true, strict: true }`，不允许 schema 中的 unknown keywords
- **无框架依赖：** 测试运行器使用 Node.js 内置 `node:test`，无 mocha/jest/vitest
- **可移植性：** 所有文件路径使用 `import.meta.url` 相对构造，不使用 `__dirname`

---

## 8. E2E / Smoke 验收证据（Harness 最终检查）

```bash
# Step 1: 冻结分类语义核查
node -e "const m=require('./product-map/generated/product-map.json'); console.log(JSON.stringify({apps:m.apps.map(a=>[a.id,a.lines.map(l=>l.id)]),gps:m.golden_paths.map(g=>[g.app_id,g.line_id,g.id,g.status]),surfaces:m.surfaces,editions:m.editions},null,2))"

# 期望输出:
# {"apps":[["customer_app",["line01","line02","line04"]],["staff_app",["line00"]]],"gps":[["staff_app","line00","skill_acceptance","active"],["staff_app","line00","ability_acceptance","proposed"],["staff_app","line00","line_health","active"]],"surfaces":["web","api","android","windows"],"editions":["personal_wechat","wecom"]}

# Step 2: 完整合同 + 干净生成
npm run product-map:validate
npm run test:product-map
npm run product-map:check
git diff --check
git status --short

# Step 3: 3 个负向用例（逐一临时测试，不 commit）
# 3a. GP app_id 改为 missing_app → validate 必须报 "references unknown app"
# 3b. required_surfaces 改为 mobile → validate 必须报 "references unknown surface"
# 3c. AGENTS.md 加入 customer_app → test 必须报 "duplicates Product Map fact"
```

---

## 9. Commit 计划（7 个 commit）

| Commit | 消息 | 关键文件 |
|--------|------|----------|
| C1 | `feat(product-map): add schema and confirmed taxonomy` | package.json, product-map.yaml, product-map.schema.json, lib.mjs, product-map.test.js |
| C2 | `feat(product-map): enforce taxonomy references` | lib.mjs, product-map.test.js |
| C3 | `feat(product-map): generate deterministic projections` | lib.mjs, cli.mjs, product-map.test.js, generated/* |
| C4 | `docs(agents): load one generated product map` | AGENTS.md, .claude/CLAUDE.md, DEFINITION.md, docs/engineering/agent-policy.md, lib.mjs, product-map.test.js |
| C5 | `docs(product-map): define ownership and GP admission` | product-map/README.md, product-map.test.js |
| C6 | `ci(product-map): block taxonomy and projection drift` | test-registry.yaml, ci-l2-consistency.yml |
| C7 (条件) | `fix(product-map): close contract verification gap` | 仅在 Step 7 验证发现修正时创建 |

---

## 10. 复审检查点

- **产品复审：** 确认初始地图仅含已批准分类，`ability_acceptance` 保持 `proposed`
- **工程复审：** 确认 schema 严格性、关系错误、确定性摘要、生成文件漂移行为
- **Harness 评估复审：** 若任何 provider bootstrap 含手写 App/Line/GP 列表，或客户侧 GP 从旧 Path 文档推断，则拒绝该任务

---

## 11. Invariant 加载摘要

| 来源 | 条目 | 加载状态 |
|------|------|---------|
| `repo-lead.md` | 部门配置（zenithjoy-workspace） | 已加载 |
| `CLAUDE.md` (project) | Walking Skeleton 铁律 + E2E-First 规则 | 已加载 |
| `CLAUDE.md` (global) | 语言/安全/分支/Bug Fix 规范 | 已加载 |
| PrepPRD (Brain task payload) | 7 个 Task + DoD 12 条 | 已加载 |
| `test-registry.yaml` | 当前测试注册表结构 | 已加载 |
| `ci-l2-consistency.yml` | 现有 L2 job 结构 | 已加载 |
| `DEFINITION.md` | 当前手写架构事实（待替换） | 已加载 |

**invariant 加载数：7**  
**累积 FR 数：6（FR-01 ~ FR-06）**

---

## 12. 元数据

```yaml
journey_type: infrastructure
target_environment: github_actions + local_node
nfr_section: "第 7 节 (非功能需求) — 确定性/速度/严格模式/无框架依赖/可移植性"
prd_lines: ~220
task_id: 9130f0be-8e8d-4cc5-96f5-7a5313804496
sprint_dir: sprints/07280933-product-map-ssot-claude
```
