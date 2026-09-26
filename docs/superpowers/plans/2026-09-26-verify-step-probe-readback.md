# verify-step 探针执行机侧读回 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 执行机在 `workflow-result.sh stage` 回执 Brain 前，按 `checks/social-keyword-leadgen.yaml` 读回该 stage 的探针 observed 填进 `result.probes`。

**Architecture:** 新增零依赖 ESM `verify-step.mjs`（核心 `runProbes` 依赖注入 pool/fetch，CLI 一行 JSON、永远 exit 0）；`workflow-result.sh` 新增 `probe_stage`，只对 YAML 有探针的 stage 拉起 node，输出经 jq 校验后传 `brain_post` 第 6 参；不判定。

**Tech Stack:** node ≥ 20（内建 fetch / node:test）、bash+jq、pg（仅生产惰性 require）。

## Global Constraints

- `__tests__/*.test.mjs` 在 CI 里 `node --test` 不装依赖：禁顶层 require 第三方包。
- sql 占位符必须参数化 `$1/$2`，禁字符串拼接。
- 单条失败 fail-open；整体超时输出已得部分；exit 0；bash 侧永远 exit 0。
- 新增 grep 一律 `|| true` 再判（smoke 里用 here-string）。

---

### Task 1: `parametrize` + `runProbes`（sql / http / fail-open / timeout）

**Files:** Create `services/phone-adb-controller/verify-step.mjs`；Test `services/phone-adb-controller/__tests__/verify-step.test.mjs`

**Produces:** `parametrize(query, {runTag, lineKey, word}) → {text, values}`；`runProbes({doc, stage, params, deps:{pool?, fetch?, feishuCreds?, now?}, timeoutMs}) → {stage, probes:[{key, observed?, probed_at, error?}]}`。

- [ ] Step 1 写失败测试（parametrize 两占位符→$1/$2、重复占位符复用 index；runProbes 用假 pool/假 fetch 跑真 YAML 的 delivery 3 条 + scoring 2 条并断言 observed；假 pool 抛错→该条 error 其余正常；一条 never-resolve + timeoutMs=200→其余有值该条 `error:"timeout"`；假 fetch 两页 has_more→count 全量）。
- [ ] Step 2 `node --test __tests__/verify-step.test.mjs` → FAIL（模块不存在）。
- [ ] Step 3 实现 verify-step.mjs（见 spec §1；`--deps <mjs>` 隐藏参数供 CLI 超时测试注入）。
- [ ] Step 4 测试通过；Step 5 commit `feat(leadgen): verify-step.mjs 探针读回核心（sql 参数化 + 飞书分页 + fail-open + 超时）`。

### Task 2: CLI（参数、凭据加载、超时后 exit 0）

**Files:** Modify `verify-step.mjs`（`main()`）；Test 追加 `verify-step.test.mjs`（spawnSync 真进程）。

- [ ] Step 1 失败测试：`--deps` 指向 never-resolve 假模块 + `--timeout-ms 300` → stdout 恰一行 JSON，`probes[0].error==="timeout"`，status 0，耗时 < 5s；缺 `--stage` → stdout `{"stage":"","probes":[]}` status 0。
- [ ] Step 2 FAIL；Step 3 实现 `main()`（argv 解析、loadChecks、飞书凭据 env→clawdbot.json、`process.stdout.write(json, () => process.exit(0))`）；Step 4 PASS；Step 5 commit `feat(leadgen): verify-step CLI 参数/凭据/超时 exit 0`。

### Task 3: `workflow-result.sh` 接线 + `harvest-cron-v4.sh` export

**Files:** Modify `workflow-result.sh`（`brain_post` 第 6 参、`src_fill`/`stage_has_probes`/`probe_stage`、`init` 导出 `WFR_TAG/WFR_PROFILE`）、`harvest-cron-v4.sh:27`；Test 追加 `workflow-result.test.mjs`（假 node stub：含 `verify-step` 走 canned，否则 exec 真 node）。

- [ ] Step 1 失败测试：delivery + canned `{"stage":"delivery","probes":[{"key":"videos_readback","observed":2,"probed_at":"t"}]}` → 回执 body `result.probes` 等于该数组且 stub 收到 `--run-tag t15 --line-key p1`；discovery → stub 未被以 verify-step 调用、probes `[]`；stub exit 3 / 输出垃圾 → probes `[]` + stderr `WFR_WARN`，status 0；init 输出含 `WFR_TAG=`/`WFR_PROFILE=`。
- [ ] Step 2 FAIL；Step 3 实现；Step 4 PASS（全部 workflow-result 测试仍绿）；Step 5 commit `feat(leadgen): 账本 stage 回执前调 verify-step 读回探针合进 result.probes`。

### Task 4: README 部署 + smoke 层 29

**Files:** Modify `services/phone-adb-controller/README.md`（基座 1/7 段）、`.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`（末尾层 29）。

- [ ] Step 1 smoke 追加：`node --check verify-step.mjs`；`grep -qF 'verify-step' workflow-result.sh`；`grep -qF -- '--argjson probes' workflow-result.sh`；`grep -qF 'WFR_TAG WFR_PROFILE' harvest-cron-v4.sh`；README 含 `zenithjoy-db.env`、`feishu.env`、`verify-step.mjs`。先跑一次看它对旧 main 会红（proven-to-fire：临时 `git stash`禁用→改用 `git show origin/main:… > /tmp` 比对不可行，直接用变异：把 README 行删掉跑 smoke 应 FAIL，再恢复）。
- [ ] Step 2 `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` → PASS；Step 3 commit `docs(leadgen): verify-step 部署清单 + smoke 层 29`。
