# cp-0926235341-leadgen-probe-via-mmv-ssh：探针读回改经 ssh 在 MMV 跑 + videos_readback 口径

### 根本原因
- 棒3b 把 verify-step.mjs 部署到执行机（xian-m4 / M1）本地跑，但 leadgen Postgres（zenithjoy 库）只在 MMV `127.0.0.1:5432` 监听、飞书凭据 `~/.openclaw/clawdbot.json` 也只在 MMV——执行机上三条 delivery 探针必然全 error。落池脚本 push-videos.js 早就是"scp TSV 到 MMV 再 ssh 过去跑"的形状（batch2.sh:55），探针读回没照抄同一条路。
- 同 TAG 下 `videos_readback=0` 而 `line_key_not_null` 读回 7 行：前者多了 `AND line_key = '$LINE_KEY'`，而 `--line-key` 传的是 profile 名 `jinoshengyuan-work`，库里 `leadgen_videos.line_key` 存的是路由键 `jinuo`（push-videos.js:57 `ROUTE.key`）。只读 SQL 实证：`line_key='jinoshengyuan-work'` → 0，`line_key='jinuo'` → 7。

### 下次预防
- 凡"读回"探针，先问数据在哪台机器：数据/凭据在哪，读回就在哪跑；执行机只负责发 ssh 并接末行 JSON。远端命令形状照抄仓内已验证的同类 ssh（batch2.sh:55），别另起一套。
- 同一张表同一批次的多条探针，WHERE 必须一字不差（checks 单测 `sqlShape` 钉住）；占位符语义（profile 名 vs 路由键）在入口处统一归一（`resolveLineKey`），不要在 SQL 里猜。
- 执行机本机不再放 checks YAML 时，哪些 stage 走 ssh 用 `WFR_PROBE_STAGES` 兜底闸，且由 checks 单测断言它 == YAML 的 stage 集合，防两边漂。
- bash 3.2 的 `printf %q` 会把中文拆成八进制转义，远端参数用单引号包裹函数 `sq` 而不是 `%q`。
- 假 ssh 桩回放多行输出要走文件 `cat`，`printf '%s\n' "<JSON.stringify>"` 里的 `\n` 不会被 bash 双引号解释成换行。

- [ ] 影子跑一晚后核对 Brain `task_runs.result.probes` 三条 delivery 都有 `observed`（无 `error`），videos_readback == line_key_not_null 行数
