# cp-0926225220-verify-step-probes：探针执行机侧读回

### 根本原因
- 棒1 回执线把 `result.probes` 写死 `[]`，Brain 侧 judge 对每条 step_probe 都判 `probe_missing`；执行机没有任何一处读回 YAML 探针。
- 测试桩以 `*verify-step*` 匹配 `$*` 判断"是否在调 verify-step"，而 worktree 目录名恰好是 `verify-step-probes`，ledger.mjs 的绝对路径也命中——桩把账本调用当成探针调用，两条测试假红。

### 下次预防
- 假可执行文件按 `$*` 分流时，匹配串必须带文件名后缀（`*verify-step.mjs*`），不能只用词干；路径里任何目录名都可能撞上。
- 执行机侧读回类脚本三条死规矩：占位符走参数化（`parametrize` 单测断言 SQL 文本不含值）、单条 fail-open、整体超时后 `process.stdout.write(json, () => process.exit(0))`——不 exit 会被 pg 连接池挂住。
- bash 钩子只对 YAML 里有该 stage 的探针才拉 node：`grep -qE '^[[:space:]]+stage:[[:space:]]*<stage>[[:space:]]*$'`，discovery/collection 每词一次不值得起进程。

- [ ] 影子跑一晚后核对 Brain `task_runs.result.probes` 五条都有 `observed`（无 `error`），再评估 severity 升 error
