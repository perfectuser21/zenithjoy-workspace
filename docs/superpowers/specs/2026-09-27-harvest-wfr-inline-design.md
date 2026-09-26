# 账本钩子并入现网采收脚本本体（棒3b-3）设计

Brain 任务 85247c00 · 决策 2ca30c4d / 2ebef90e · 仓库 `services/phone-adb-controller/`

## 背景

基座 1/7（#1937）用 `harvest-cron-v4.sh` / `batch2-v4.sh` 独立副本承载账本钩子，计划影子跑 2 晚再切 crontab。09-27 实证三点失效：

1. 副本与现网分叉：现网 `batch2.sh` 有 `LINE` 第 6 参传 harvest-keyword.sh 与 push-videos/push-raw-comments（决策 e2cef2c9 ④）、落池后 `sort-comments.js` 分拣、`AUDIO` manifest + `judge-video.js` 音频判定链、`MAXV` 参数；`harvest-cron.sh` 按 `${BIZ}` 调 `update-keyword-stats.js`（e2cef2c9 ③）。v4 一个都没有，切 v4 = 回退四处修复。
2. 影子跑拿不到设备：金诺号 22/02/06 三批各跑 3-5 小时衔接无空窗，12 词全 `discovery blocked`。
3. v4 起跑的"孤儿 escort 清理"把仍在跑的 22:00 生产批 escort（5b04c346）杀了。

## 方案

钩子直接内建进现网脚本本体，单份代码。守卫函数一行：

```zsh
wfr_on(){ [[ "${WFR_DISABLED:-0}" != "1" && -x "$WFR" ]] }
```

`WFR` 默认 `$HOME/bin-harvest/workflow-result.sh`；不存在、不可执行或 `WFR_DISABLED=1` → 所有钩子 no-op，采收行为与并入前逐字一致。

### harvest-cron.sh

- 顶部库块（`HARVEST_CRON_LIB=1` source 模式可单测）：`WFR`、`BATCH2`、`wfr_on`、`finalize_needed`、`wfr_bootstrap`（init→export→enter→export，堵 C1 子进程看不到账本位置的洞）。
- `wr_start` 保留 stdout 捕获 `WFR_BRAIN_TASK_ID` 并 export。
- escort 拉起后 30s `cron list` 复核，未命中 escalate。
- `run_finalize` 挂 trap（有 escort 时与 `escort_dismiss` 串联）；`finalize_needed` 为假（正常退让路径）只记 skipped。
- 取词单成功后 `wfr_bootstrap`；采收主体 `BATCH2` 调用签名不变（`P WF TAG PUSH SERIAL`），捕获 stdout 判 `BATCH2_ESCALATE=hash_mismatch` 则 escalate。
- **孤儿 escort 清理整段不并入**：`openclaw cron list` 只有名字，无法区分"上批 kill -9 遗留"与"同机另一批仍在跑"（三批衔接无空窗，任一起跑都会看见前一批的活 escort）。kill -9 遗留由 escort 自身 `--timeout 90000` + 分身值守兜底，不值得冒误杀风险。
- 现网逻辑全保留：KPI 闸、词单缓存、`update-keyword-stats.js '${BIZ}'`。

### batch2.sh

- 保留 `LINE="${6:-$P}"`、`MAXV`、分拣、AUDIO/judge-video 链、`source zenithjoy-db.env` 的 ssh 形状，harvest-keyword.sh 调用签名（`P ENC MAXV TAG unlimited LINE`）逐字不动。
- 起跑 hash 校验（`wfr_on` 且 `WFR_HASH` 非空时）：不一致 → `stage discovery blocked 0 hash_mismatch` + `print BATCH2_ESCALATE=hash_mismatch` + exit 0（fail-closed）。
- `WFR_SKIP_WORDS` 续跑跳词（仅 `wfr_on`）。
- 每词前后 `count VIDEO/LEAD` 增量；rc 捕获（`|| rc=$?`）；映射：`0 && DV>0` → discovery completed + collection completed；`0 && DV==0` → discovery blocked no_cards；`3` → blocked lock_busy；其它 → failed。
- push 后：push rc==0 → `delivery completed`（`leads_written=$NL`）；rc≠0 → `delivery failed`；`PUSH!=1` 或无输出 → `delivery blocked`。分拣与音频判定链只在 push 成功分支后继续（与旧行为一致：旧版 push 失败也会继续分拣——为保持"逐字一致"，分拣/判定不因 prc 改变，只是 delivery 状态记录 prc）。
- `BATCH_SLEEP` 可覆盖（测试用 0），默认 20 与旧版 `20 + RANDOM%40` 一致。

### 删除与文档

- 删 `harvest-cron-v4.sh`、`batch2-v4.sh`。
- README「基座 1/7 影子跑」改「钩子内建」：部署 = `scp harvest-cron.sh batch2.sh workflow-result.sh wall-report.sh ledger.mjs → ~/bin-harvest/`，crontab 不动；`WFR_DISABLED=1` 可关；账本验收判据保留。
- smoke 层 22 去掉 `_V4_EXCLUDE`；层 28/29 对 v4 的断言改指 `harvest-cron.sh`；新增守卫：`batch2.sh` 必带 `wfr_on`、hash_mismatch、stage discovery/collection/delivery；`harvest-cron.sh` 必带 `wfr_bootstrap`、`run_finalize`、不得含孤儿清理（`孤儿escort清理` 字样）。

## 测试

`__tests__/pipeline-v4-integration.test.mjs` 改指现网脚本（node:test，无 zsh/jq 时 `t.skip`）：

1. 四出口码 → 阶段状态映射；工件 n=词序；collection metrics 真实计数。
2. LINE 第 6 参照旧传递（假 harvest-keyword.sh 记录 argv；显式传 LINE=devline 与不传回落 P 两种）。
3. `WFR_DISABLED=1`：不写账本目录、`night-*.log` 与旧版形状一致（无 attempt 字样）、harvest-keyword 仍被逐词调用。
4. hash_mismatch 停跑 + 不覆盖上一 attempt 记录。
5. skip_words 跳词。
6. harvest-cron 库函数：`wfr_on` 三态、`finalize_needed`、`wfr_bootstrap` 后 attempt_id=a1。
7. delivery 阶段：PUSH=0 → blocked。

smoke 静态守卫见上。

## 不包含

孤儿 escort 清理的替代方案（如按 harvest-cron.log 批完成时间判）——留待有可靠判据后另立。
