# 账本钩子并入现网采收脚本本体（棒3b-3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `harvest-cron-v4.sh` / `batch2-v4.sh` 里的账本钩子并入现网 `harvest-cron.sh` / `batch2.sh` 本体，删除 v4 副本，`WFR_DISABLED=1` 或 `workflow-result.sh` 缺失时采收行为与并入前逐字一致。

**Architecture:** 两个 zsh 脚本各加一行守卫 `wfr_on()`，所有账本调用经 `wfr` 包装（no-op 安全）；batch2.sh 的旧日志/落池/分拣/音频链一行不动，只在其间插入 stage 写入；harvest-cron.sh 顶部加可 source 的库块（`HARVEST_CRON_LIB=1`）供单测。孤儿 escort 清理段不并入（决策 2ebef90e）。

**Tech Stack:** zsh 脚本、bash `workflow-result.sh`、node:test（`node --test`，不装依赖，无 zsh/jq 时 skip）、smoke 静态守卫。

## Global Constraints

- 目录 `services/phone-adb-controller/`；CI 命令 `node --test services/phone-adb-controller/__tests__/*.test.mjs`（ci-l3-code.yml:235）
- harvest-keyword.sh 调用签名逐字不动：`"$P" "$ENC" "$MAXV" "$TAG-w$n" unlimited "$LINE"`
- 新增 grep 一律 `|| true` 再判
- 提交 Conventional Commits；分支 `cp-0927040952-harvest-wfr-inline`；GP-Anchor: none(infra)
- 测试 commit 顺序：commit-1 失败测试 / commit-2 实现

---

### Task 1: 冻结并入前 batch2.sh 为回归基线 fixture + 改写集成测试（红）

**Files:**
- Create: `services/phone-adb-controller/__tests__/fixtures/batch2-pre-wfr.sh`（= origin/main `batch2.sh` 逐字副本，md5 `2abbb72968b4f8f1f03660425ef2dfa1`）
- Rewrite: `services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`

**Interfaces:**
- Produces: 测试期望 `batch2.sh` 支持 env `HARVEST_KEYWORD`（默认 `$HOME/bin-harvest/harvest-keyword.sh`）、`WFR`、`BATCH_SLEEP`、`WFR_DISABLED`；`harvest-cron.sh` 支持 `HARVEST_CRON_LIB=1 source` 后暴露 `wfr_on`/`finalize_needed`/`wfr_bootstrap`

- [ ] **Step 1: 建 fixture**

```bash
git show origin/main:services/phone-adb-controller/batch2.sh > services/phone-adb-controller/__tests__/fixtures/batch2-pre-wfr.sh
md5 -q services/phone-adb-controller/__tests__/fixtures/batch2-pre-wfr.sh   # 2abbb72968b4f8f1f03660425ef2dfa1
```

- [ ] **Step 2: 重写测试**（假 harvest-keyword.sh 记录 argv 到 `$HOME/hk-argv.log`，按词回 0/1/3；假 `ssh`/`scp` 放 `$HOME/.local/bin/`（batch2 PATH 首位）记录 argv 到 `$HOME/ssh-argv.log` 并 exit 0）

测试清单：
1. 四出口码 → discovery/collection 状态；工件 n=词序；collection metrics
2. LINE 第 6 参：传 `devline` → hk argv 第 6 参 = devline 且 push-videos/push-raw-comments/sort-comments/judge-video 的 ssh 命令含 ` devline`；不传 → 第 6 参 = profile
3. `WFR_DISABLED=1`（PUSH=1，假 ssh/scp）：账本 discovery.items 为空、无 discovery/delivery 工件；`night-*.log`（去时间戳）、`night-*.tsv`、hk argv、ssh argv 与 fixture 跑出的逐字一致
4. `WFR` 指向不存在文件时同 3 的账本断言
5. hash_mismatch：BATCH2_ESCALATE、blocked n=0、不覆盖上一 attempt、skip_words 含 ok
6. skip_words 跳词
7. delivery：PUSH=1 且 push ssh 成功 → completed leads_written=2；PUSH=0 → blocked
8. harvest-cron 库：`wfr_on` 三态；`finalize_needed`；`wfr_bootstrap` 后 attempt_id=a1；`WFR_DISABLED=1` 时 `wfr_bootstrap` 不建账本目录

- [ ] **Step 3: 跑测试确认红**

Run: `node --test services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`
Expected: 多条 FAIL（batch2.sh 无账本写入、harvest-cron.sh 无库函数）

- [ ] **Step 4: Commit**

```bash
git add services/phone-adb-controller/__tests__/
git commit -m "test(leadgen): 账本钩子并入现网 batch2/harvest-cron 的失败测试先行（棒3b-3）"
```

### Task 2: batch2.sh 并入钩子（绿）

**Files:**
- Modify: `services/phone-adb-controller/batch2.sh`

要点（旧行保留原文）：
- 头部加 `HK`/`WFR`/`wfr_on`/`wfr`/`SLEEP_BASE`/`count`/`wfr_word_stages`
- 起跑 hash 校验（`wfr_on && -n WFR_HASH`）→ 不一致写 blocked n=0 + `print BATCH2_ESCALATE=hash_mismatch` + exit 0
- 词循环：`wfr_on` 且命中 `WFR_SKIP_WORDS` 跳过；V0/L0 → `"$HK" … "$LINE"` 捕获 rc → V1/L1 → `wfr_word_stages`
- sleep 改 `(( SLEEP_BASE > 0 )) && /bin/sleep $(( SLEEP_BASE + RANDOM % 40 ))`（默认 20，等价旧行为）
- push 段：ssh 后 `prc=$?` → delivery completed/failed；`else` 分支 delivery blocked；分拣/音频链原文不动

- [ ] Run: `node --test services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs` → batch2 相关全 PASS
- [ ] Commit: `feat(leadgen): batch2.sh 内建账本钩子（每词 discovery/collection、delivery、hash fail-closed；WFR_DISABLED 可关）`

### Task 3: harvest-cron.sh 并入钩子（绿）

**Files:**
- Modify: `services/phone-adb-controller/harvest-cron.sh`

要点：
- 顶部库块：`WFR`/`BATCH2`/`wfr_on`/`finalize_needed`/`wfr_bootstrap`/`[[ HARVEST_CRON_LIB == 1 ]] && return 0`
- `wr_start` 捕获 `WFR_BRAIN_TASK_ID` 并 export（日志行仅 wfr_on 时打）
- escort 拉起后 30s `cron list` 复核；`run_finalize`（`wfr_on || return 0`）挂 trap
- 取词单后 `wfr_bootstrap "$TAG" "$P" "$WF" "$PUSH" "$SERIAL" "$HOSTKEY"`
- 采收主体 `B2OUT=$(/bin/zsh "$BATCH2" … 2>&1 | tee -a $LOG || true)`，命中 `BATCH2_ESCALATE=hash_mismatch` 则 escalate
- 不并入孤儿 escort 清理

- [ ] Run: `node --test …` 全 PASS；`zsh -n` 两脚本
- [ ] Commit: `feat(leadgen): harvest-cron.sh 内建账本 bootstrap/finalize + escort 复核，不并入孤儿清理`

### Task 4: 删 v4、README、smoke、deploy 清单

**Files:**
- Delete: `harvest-cron-v4.sh`、`batch2-v4.sh`
- Modify: `README.md` 基座 1/7 段；`wall-report.sh:85` 注释；`deploy.sh` 加 `DEVICE_NODE_FILES=(ledger.mjs)`；smoke 层 22/28/29 + 新层 30

- [ ] Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` → PASS；对 origin/main 的旧 batch2.sh 跑层 30 应 fail（proven-to-fire）
- [ ] Commit: `chore(leadgen): 删 v4 影子副本，README/smoke/deploy 改指钩子内建`
