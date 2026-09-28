# 主干活动契约第一棒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（inline）。每个 Task 先提交失败测试（commit-1），再提交实现（commit-2）。

**Goal:** 关键词获客 8 活动契约 + 对象类型表 + 15 字段 schema + 组装闸 + 全拦截级探针，对标链接获客只换发现即组装成功。

**Architecture:** 契约 YAML 放 `product-map/contracts/`，由 `scripts/product-map/contracts-lib.mjs`（Ajv 2020 + yaml，同 lib.mjs）校验、交叉引用 checks YAML 与 product-map.yaml、按类型流组装、算 sha256 写 `product-map/generated/contracts.json`。探针层（零依赖 probes-lib）扩 `metric` 类型与 `outreach` stage，全部 `severity: error`。

**Tech Stack:** Node 20，node:test，ajv/dist/2020、yaml（根 package 已有）。

## Global Constraints
- 设计顺序：preflight → discovery → qualification → collection → scoring → delivery → outreach → cleanup（决策 f18f56b8）
- 所有探针 `severity: error`；契约 postcondition 只能引 error 级探针
- 步骤 key `^[a-z][a-z0-9_]*$`，活动内唯一，不带序号；`order` 为数字
- `failure` 闭集 empty_ok / retryable / needs_human / fatal；needs_human 必带 alert
- 不改生产执行脚本（harvest-cron.sh / batch2.sh / outreach-tick.sh / workflow-result.sh 行为不变）

---

### Task 1: 探针层——metric 类型 + outreach stage + 全部 error + 补 6 个活动的探针
**Files:** Modify `services/phone-adb-controller/checks/{schema.json,probes-lib.js,social-keyword-leadgen.yaml}`、`services/phone-adb-controller/verify-step.mjs`；Test `services/phone-adb-controller/__tests__/{checks-social-keyword-leadgen,verify-step}.test.mjs`
**Produces:** STAGES 8 项（设计顺序）；probe `{type:"metric", ref:"metrics.<key>"}`；verify-step 对 metric 探针 observed = metrics-json[key]。
- [ ] 改测试：钉全部 error、8 个 stage 各 ≥1 探针、metric 探针 ref 属闭集、outreach 探针只能 sql/http；verify-step metric 读值用例 → 跑红 → commit-1
- [ ] 改 schema/probes-lib/yaml/verify-step → 跑绿 → commit-2

### Task 2: 契约 schema + 对象类型表 + contracts-lib
**Files:** Create `product-map/contracts/{activity-contract.schema.json,object-types.yaml}`、`scripts/product-map/contracts-lib.mjs`；Test `scripts/product-map/__tests__/contracts.test.js`
**Produces:** `loadContracts(repoRoot) → {objectTypes, capabilities: Map<id, doc>}`；`validateContracts(repoRoot) → string[] errors`；`assemble(capId, ctx) → {ok, errors, activities}`；`contractsDigest(ctx) → {capabilities:{id:{sha256, activities:{key:sha256}}}}`。
- [ ] 测试用内存 fixture 覆盖反例（缺 postcondition / warn 探针 / 类型断链 / 步骤无 check / llm 无 model / needs_human 无 alert / req_keys 阶段无契约 / 未知对象类型 / 未知能力）→ 红 → commit-1
- [ ] 实现 → 绿 → commit-2

### Task 3: 关键词获客 8 活动契约 + 对标链接获客
**Files:** Create `product-map/contracts/{keyword_acquisition.yaml,benchmark_link_acquisition.yaml}`；Test 同 contracts.test.js（真实文件用例）
- [ ] 测试：真实仓库 validateContracts 零错误；assemble 两个能力都 ok；对标只自有 discovery、其余 7 个 ref；删 qualification 契约 → assemble 失败（proven-to-fire）→ 红 → commit-1
- [ ] 写两份 YAML → 绿 → commit-2

### Task 4: 生成物与 CI 接线
**Files:** Modify `scripts/product-map/cli.mjs`（generate 写 contracts.json，check 比对，validate 调 validateContracts）、`package.json`（test:product-map 加 contracts.test.js）；Create `product-map/generated/contracts.json`
- [ ] `npm run test:product-map && npm run product-map:generate && npm run product-map:check` 全绿 → commit
