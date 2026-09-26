# verify-step.mjs：探针在执行机侧读回（棒3b workspace 侧）

Brain 任务 41890619 · 决策 95e29afd（探针在执行机读回，Brain 只判定）· 前置 #1981（回执线）/ #1982（探针 YAML）/ cecelia #5590（business-probe-judge）。

## 目标

`workflow-result.sh stage` 回执 Brain 时 `result.probes` 现在是 `[]`。本 PR 让执行机（xian-m4 / M1）在 POST 前按 `checks/social-keyword-leadgen.yaml` 把该 stage 的探针**读回**成 `[{key, observed, probed_at, error?}]` 填进去。不判定、不比对 expect——那是 Brain 侧 `business-probe-judge` 的事。

## 组件

### 1. `services/phone-adb-controller/verify-step.mjs`（新）

CLI：`node verify-step.mjs --stage <name> --run-tag <TAG> --line-key <key|profile|line> [--word <W>] [--checks <yaml>] [--metrics-json <file>] [--timeout-ms <n>]`

- 用 `checks/probes-lib.js loadChecks()` 读 YAML；schema 错误 → 输出 `probes:[]` 并在 stderr 报错（exit 0）。
- 只取 `probe.stage === --stage` 的条目；各条并行跑。
- **sql**：`leadgen-db-connect.js getPool()`；占位符 `'$RUN_TAG'`/`'$LINE_KEY'`/`'$WORD'`（带或不带引号）按出现顺序替换为 `$1/$2/...` 参数化，禁止字符串拼接。observed：单行单列 → 该值（数值化）；多行 → 逐行首列数组（`not_null_all` 用）。
- **http**（飞书 Bitable）：token 走 `auth/v3/tenant_access_token/internal`（凭据顺序：env `FEISHU_APP_ID/FEISHU_APP_SECRET` → `CLAWDBOT_JSON`(默认 `~/.openclaw/clawdbot.json`) 的 `channels.feishu.accounts[routeOf(lineKey).account]`，同 push-raw-comments.js:6-16）；`url?page_size=500&page_token=` 分页拉全；filter 每列全等（文本字段经 `txt()` 归一，布尔直接比）；reduce `count` | `field:<列>`（数值求和）；`minus` 同形子查询，observed = 主 − 子。
- 每条独立 try/catch：失败 → `{key, probed_at, error}` 继续其余（fail-open）。
- 整体超时（默认 60s）：到点把已得部分输出，未完成的条目标 `error:"timeout"`，`process.exit(0)`。
- stdout 恰好一行 JSON `{"stage","probes":[...]}`；永远 exit 0。
- 导出 `runProbes({doc, stage, params, deps:{pool, fetch, now}})` 与 `parametrize(query, params)` 供单测依赖注入，`main()` 只在直接执行时跑。

### 2. `workflow-result.sh`（改）

- `init` 额外 echo `WFR_TAG=$TAG`、`WFR_PROFILE=$P`（`harvest-cron-v4.sh wfr_bootstrap` 的 export 行同步加上）。
- `write_stage` 校验通过后、`brain_post` 前：若 `WFR_CHECKS_YAML` 里有该 stage 的探针（`grep -E "^[[:space:]]+stage: $stage[[:space:]]*$" || true`），子壳 source `WFR_DB_ENV`(默认 `~/.credentials/zenithjoy-db.env`) 与 `WFR_FEISHU_ENV`(默认 `~/.credentials/feishu.env`，本机既有命名惯例，只补空位) 后跑 `node verify-step.mjs --stage --run-tag $WFR_TAG --line-key $WFR_PROFILE --word $word --checks $WFR_CHECKS_YAML`；输出经 `jq '.probes|type=="array"'` 校验后传给 `brain_post` 第 6 参 `probes_json`；node 不在/非零/输出不是数组 → 记 `WFR_WARN verify-step ...`，probes 保持 `[]`。
- `brain_post` 新增第 6 参（默认 `[]`），`--argjson probes` 写进 `result.probes`。
- 路径变量：`WFR_VERIFY_MJS`(默认 `$HOME/bin-harvest/verify-step.mjs`)、`WFR_CHECKS_YAML`(默认 `$HOME/bin-harvest/checks/social-keyword-leadgen.yaml`)。

### 3. 测试（`__tests__/verify-step.test.mjs` + `workflow-result.test.mjs` 追加）

- 参数化：`'$RUN_TAG'` 与 `'$LINE_KEY'` → `$1/$2`，params 顺序正确，重复占位符复用同一 index。
- 输出形状：五条探针（假 pool + 假 fetch）→ 5 条 `{key, observed, probed_at}`，count/field/minus/not_null_all 各自 observed 正确。
- 单条失败 fail-open：假 pool 抛错 → 该条带 error，其余正常。
- 整体超时：一条永不 resolve → 到点输出其余，该条 `error:"timeout"`，exit 0（spawn 真进程测 CLI）。
- 飞书分页：假 fetch 返回 `has_more` 两页 → 全量计数。
- workflow-result.sh：假 `node` stub 输出固定 probes → 回执 body `result.probes` 合并；stub 非零/输出垃圾 → `probes:[]` + `WFR_WARN`，exit 0；discovery（YAML 无探针）不拉起 node。

### 4. 部署（README「基座 1/7」段追加）

`scp verify-step.mjs leadgen-db-connect.js line-routes.js checks/{probes-lib.js,schema.json,social-keyword-leadgen.yaml}` → `~/bin-harvest/`（保持 `checks/` 子目录）；`cd ~/bin-harvest && npm i pg`；`~/.credentials/zenithjoy-db.env`（`DATABASE_URL`）+ `~/.credentials/feishu.env`（`FEISHU_APP_ID`/`FEISHU_APP_SECRET`，该业务线 base 对应的飞书应用），均 chmod 600。缺任一 → 对应探针带 error 回执（Brain 判 FAIL(probe_error)），采收不受影响。

### 5. smoke（`phone-adb-controller-smoke.sh` 层 29）

`node --check verify-step.mjs`；workflow-result.sh 含 `verify-step`、`--argjson probes`；harvest-cron-v4.sh export 含 `WFR_TAG WFR_PROFILE`；README 含 `zenithjoy-db.env` 与 `feishu.env`。

## 不包含

expect 比对 / severity 判定（Brain）；悦升 YAML 条目；bash 侧 `timeout` 命令（macOS 无 coreutils，靠 node 自限）。
