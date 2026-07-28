# Contract Definition of Done — Product Map SSOT

**Sprint ID:** 9130f0be-8e8d-4cc5-96f5-7a5313804496
**合同版本:** Round 2
**日期:** 2026-07-28

---

## DoD 核查清单（对应 PRD §6 的 12 条验收标准）

每一条须在 Harness Report 中提供可查证据（日志截图 / 命令输出 / 文件内容片段）。

| # | 验收标准 | 证据类型 | 对应 BEHAVIOR |
|---|---------|---------|--------------|
| 1 | `product-map.yaml` 是唯一手写分类来源 | `git grep -rn "customer_app\|line01\|line02\|line04\|line00\|skill_acceptance"` 输出仅命中 `product-map.yaml` 及 `generated/` 和本合同文件 | BEHAVIOR-01 |
| 2 | 精确解析两个 App：`customer_app` 和 `staff_app` | `loadAndValidateProductMap()` 返回 `map.apps.length === 2` 且 ids 精确匹配 | BEHAVIOR-01 |
| 3 | `customer_app` 拥有 Line 01/02/04；`staff_app` 拥有 Line 00 | Step 4 分类语义核查脚本输出与期望 JSON 一字不差 | BEHAVIOR-02 |
| 4 | `staff_app/line00` 解析 3 个已确认 GP | GP 数组精确 3 条，status 精确匹配（ability_acceptance=proposed） | BEHAVIOR-02 |
| 5 | Line 01/02/04 不含虚构 GP 条目 | `map.golden_paths.filter(g => ['line01','line02','line04'].includes(g.line_id)).length === 0` | BEHAVIOR-02 |
| 6 | Surfaces/Editions 验证正确 | `map.surfaces` 和 `map.editions` 精确集合匹配 | BEHAVIOR-03 |
| 7 | 无效引用产生可操作错误消息 | 3 个负向用例（Step 7/8/9）均通过，错误消息含规定关键词 | BEHAVIOR-05 |
| 8 | 规范 JSON/MD 携带摘要；`check` 检测漂移 | 两文件摘要一致；修改 YAML 后 `check` exit 1 | BEHAVIOR-06/07 |
| 9 | 3 个 bootstrap 文件指向生成投影，不含分类拷贝 | `assertBootstrapParity` 无报错；负向注入报错 | BEHAVIOR-08 |
| 10 | Product Map Job 无 paths 过滤器 | CI YAML diff 展示 `product-map-contract` Job 无 `paths:` | BEHAVIOR-10 |
| 11 | 全部 7 个测试通过，生成文件当前，分支干净 | `npm run test:product-map` 输出 `7 passing`；`git status --short` 无 dirty 文件 | BEHAVIOR-01~09 |
| 12 | PR 不含 Brain/MIXED/Staff Hub UI/验收持久化/自动生成实现 | PR diff 无上述路径的新增文件 | BEHAVIOR-12 |

---

## 测试完成标准

- `scripts/product-map/__tests__/product-map.test.js` 存在，运行 `npm run test:product-map` 输出 **恰好 7 个测试通过**（不多不少）
- 所有测试使用 Node.js 内置 `node:test`，无 mocha/jest/vitest 依赖
- `test-registry.yaml` 包含 `product-map-contract` 条目（type: unit, ci: L2, status: active）
- `orphan-test-check` CI Job 通过（无未注册测试文件）

---

## 交付物完整性核查

```
product-map/
  product-map.yaml         ✓ 唯一手写源
  product-map.schema.json  ✓ JSON Schema draft/2020-12
  generated/
    product-map.json       ✓ 含 digest
    product-map.md         ✓ 含相同 digest
  README.md                ✓ 含 7 项 assert 内容

scripts/product-map/
  lib.mjs                  ✓ 5 个导出函数
  cli.mjs                  ✓ validate/generate/check
  __tests__/
    product-map.test.js    ✓ 7 个 node:test 测试

AGENTS.md                  ✓ thin bootstrap（无手写分类）
.claude/CLAUDE.md          ✓ thin bootstrap（无手写分类）
DEFINITION.md              ✓ thin 指针（无手写分类）
docs/engineering/agent-policy.md  ✓ provider 中立策略

test-registry.yaml         ✓ 追加 product-map-contract
.github/workflows/ci-l2-consistency.yml  ✓ 追加 product-map-contract Job
package.json               ✓ 追加 4 个 npm scripts
```

---

## npm scripts 必要项

| script | 命令 |
|--------|------|
| `product-map:validate` | `node scripts/product-map/cli.mjs validate` |
| `product-map:generate` | `node scripts/product-map/cli.mjs generate` |
| `product-map:check`    | `node scripts/product-map/cli.mjs check` |
| `test:product-map`     | `node --test scripts/product-map/__tests__/product-map.test.js` |

---

## 非功能需求核查

| NFR | 验证方式 |
|-----|---------|
| 确定性（字节级幂等） | 两次 generate 后 `git diff` 无变化 |
| 速度 < 60s | CI log 中 `npm run test:product-map` step 耗时 |
| Ajv strict: true | `lib.mjs` 源码 grep `allErrors: true, strict: true` |
| 无 mocha/jest/vitest | `package.json` devDependencies grep |
| `import.meta.url` 路径 | `lib.mjs` 源码无 `__dirname` |

---

## 拒绝条件（任一触发 = PR 拒绝）

1. bootstrap 文件（AGENTS.md / .claude/CLAUDE.md / DEFINITION.md）含任何 App/Line/GP ID 或名称的字面量
2. `product-map.yaml` 包含 Line 01/02/04 的非空 golden_paths（客户侧 GP 未批准）
3. `ability_acceptance` 的 status 不为 `"proposed"`
4. CI `product-map-contract` Job 含 `paths:` 过滤器
5. 测试数量不等于 7（多了 = 范围蔓延，少了 = 未完成）
6. `test-registry.yaml` 未同步更新（orphan-test-check 会阻断）
7. 新增任何数据库迁移文件

---

## 行为断言索引（Harness 扫描格式）

[BEHAVIOR] BEHAVIOR-01: 产品分类结构解析 — loadAndValidateProductMap() 返回 map.apps 精确含 customer_app 和 staff_app，app/line 归属精确匹配，errors 为空数组；负向：缺 apps 字段时 errors 非空
[BEHAVIOR] BEHAVIOR-02: 种子分类精确性 — staff_app/line00 的 golden_paths 精确为 3 条（skill_acceptance/active、ability_acceptance/proposed、line_health/active）；customer_app 三条 Line 的 golden_paths 均为空数组
[BEHAVIOR] BEHAVIOR-03: Surface 与 Edition 类型隔离 — map.surfaces 精确为 ["web","api","android","windows"]，map.editions 精确为 ["personal_wechat","wecom"]，两集合互不交叉
[BEHAVIOR] BEHAVIOR-04: 交叉引用关系校验（有效引用通过）— validateRelations(map) 返回空数组，所有 GP 的 app_id/line_id/required_surfaces/edition 均在顶层注册表中存在
[BEHAVIOR] BEHAVIOR-05: 交叉引用关系校验（无效引用报错）— missing_app 报 "references unknown app"；"mobile" surface 报 "references unknown surface"；重复 GP id 报 "duplicate"，每条错误含具体 ID
[BEHAVIOR] BEHAVIOR-06: 确定性投影生成 — npm run product-map:generate 产出 product-map.json 和 product-map.md，两文件含相同 SHA-256 digest，连续两次生成 git diff 无变化
[BEHAVIOR] BEHAVIOR-07: 漂移检测 — check 命令在 generated 与 YAML 一致时 exit 0；修改 YAML 不重新生成后 exit 1，输出含 "drift" 或 "mismatch"
[BEHAVIOR] BEHAVIOR-08: Provider Bootstrap 无手写分类 — AGENTS.md/.claude/CLAUDE.md/DEFINITION.md 不含 App/Line/GP ID 字面量，均含 product-map/generated/product-map.md 路径引用；负向：注入 customer_app 后 assertBootstrapParity 抛 "duplicates Product Map fact"
[BEHAVIOR] BEHAVIOR-09: 贡献者文档断言 — product-map/README.md 通过 7 个 assert.match（ownership/7步工作流/3个准入条件/Surface vs Line/Edition vs Line/generated路径/validate命令）
[BEHAVIOR] BEHAVIOR-10: CI L2 Job 无 paths 过滤器 — product-map-contract Job 存在，不含 paths: 过滤器，含 npm ci/test:product-map/product-map:check 三条命令，timeout-minutes: 5，l2-passed 的 needs 含此 Job，且 l2-passed 的 FAILED 判断 shell 块含 needs.product-map-contract.result 检查（含 FAIL 字样）
[BEHAVIOR] BEHAVIOR-11: test-registry.yaml 注册 — 含 id=product-map-contract 条目，type: unit，ci: L2，status: active，path 指向 scripts/product-map/__tests__/product-map.test.js，updated: 2026-07-28
[BEHAVIOR] BEHAVIOR-12: 范围外交付物不存在 — PR 不含 Brain API 路由/Staff Hub UI 页面/DB 迁移文件/Harness 自动生成代码；product-map.yaml 不含 Line 01/02/04 的任何 Golden Path

---

## 本地验收命令

manual:bash npm run product-map:validate && npm run test:product-map && npm run product-map:check
