# cp-0927040952-harvest-wfr-inline：账本钩子并入现网采收脚本本体，废 v4 影子副本

### 根本原因
- 基座 1/7（#1937）选了"独立副本 + 影子跑 2 晚再切"，副本一落地就开始与现网分叉：现网随后修了 LINE 第 6 参（e2cef2c9 ④）、落池后 `sort-comments.js` 分拣、AUDIO manifest + `judge-video.js` 判定链（0923）、`MAXV`、按 `${BIZ}` 回写（e2cef2c9 ③）——v4 一处都没跟。"切 v4"事实上等于回退四处修复，而且没有任何守卫会提醒这件事。
- 影子跑的前提是"有空闲设备窗口"，但金诺号 22/02/06 三批各跑 3-5 小时无缝衔接，影子批 12 词全 `discovery blocked`——设计时没核对生产排班。
- v4 起跑的"孤儿 escort 清理"按 `openclaw cron list` 的名字扫，名字里只有机器+TAG，分不清"上批 kill -9 遗留"与"同机另一批仍在跑"，09-27 把在跑的 22:00 生产批 escort（5b04c346）杀了。

### 下次预防
- 给生产脚本加钩子，**内建 + 一行守卫（`WFR_DISABLED=1`/依赖缺失即 no-op）**，不要复制一份副本去影子跑；副本必分叉，且没有守卫会告诉你分叉了。
- "行为逐字一致"要用**并入前快照对拍**证明（`__tests__/fixtures/batch2-pre-wfr.sh` + 相同假桩跑两遍比日志/产物/子进程 argv），不是靠人眼 diff。
- 任何"清理别人留下的东西"的自动化，先回答"我能不能从可观测信息区分遗留与在跑"——分不清就不做，让资源自己超时（escort 有 `--timeout`）。
- 既有守卫会钉住调用行的**字面形状**（line-routes.test.mjs 要求 `harvest-keyword.sh` 与 `"$LINE"` 同行）：把路径抽成变量看似无害，实际会绕过守卫；改调用行时先跑全目录测试。
- smoke 的 glob 扩到 `*.mjs` 会把 MMV 侧件（verify-step.mjs）误判成设备侧漏件——按部署目的地分组钉，不按扩展名。

- [ ] 部署后首晚生产批（xian-m4 22:00）核对 `harvest-cron.log` 有 `Brain单:`/`账本init:`/`escort复核命中`/`账本finalize: ok=1`，Brain `task_runs` 有 delivery 回执含 probes
