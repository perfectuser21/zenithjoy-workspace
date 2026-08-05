# GP2 安卓智能获客 golden path smoke 守卫修复（P0批次）

日期：2026-08-04
关联：memory `handoff_0804_gp2_android_smoke_audit_18_findings.md`、PrepPRD `sprints/08042253-gp2-android-smoke-p0-fix/prep-prd.md`

## 背景

08-04 夜连夜审计 `golden-path-2-smoke.sh` 及配套 CI/真机车道，发现三处独立的"守卫本身失效"问题（P0 批次）。均为已有功能的 bug 修复，非新功能，无需拆解子项目。

## 根因与方案（三组件，独立、可并入同一 PR）

### 组件 1：`e2e-line02-android-collect.yml` checkout 出境网络超时

**根因**：该 workflow 的 `android-collect-smoke` job 跑在 `[self-hosted, wechat-capable]`（即 xian-rog），checkout 步骤仍是裸 `actions/checkout@v4`。xian-rog 到 github.com 的出境网络存在两层独立问题（已被 PR#1590/#1592/#1596/#1602 在三条姊妹 workflow 上验证并修复的同一根因）：出境带宽被 GFW 限速到约 10KB/s；间歇性 TCP 连接失败（"Failed to connect to github.com port 443"，内置重试落空）。08-03 晚 run 30850569351 实锤复现后者。

**方案**：完全复用 PR#1596 已验证生效的模式，不做变体：
1. checkout 前加一步临时开 HK exit-node（`tailscale set --exit-node=100.86.118.99 --exit-node-allow-lan-access`，`--exit-node-allow-lan-access` 保证真机 USB/局域网访问不受影响）
2. checkout 加 `sparse-checkout: .github/workflows/scripts/smoke`（脚本 grep 确认只依赖这一个子目录：`line02-android-collect-realmachine-smoke.sh` 只 require 了 `./.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs`）
3. checkout 后加一步 `if: always()` 关闭 exit-node（不常驻占用）

**测试**：环境接缝，无法用 CI test 复现（不存在真实 GFW 网络环境的 CI 沙箱）。守卫形态 = 运行时证据：workflow 语法正确性由 YAML lint/GHA 自身校验；proven-to-fire 证据 = 手动 `workflow_dispatch` 触发一次并观察 checkout 步骤不再报网络错误（PR 描述里贴出这次运行的 run URL 作为证据，仿照 PR#1596 的守卫写法）。

### 组件 2：`ci-smoke-glob-runner.yml` 缺 `TOAPIS_API_KEY`

**根因**：`ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job env 里有 `TOAPIS_API_KEY: ${{ secrets.TOAPIS_API_KEY }}`；`ci-smoke-glob-runner.yml` 的 `smoke-glob-runner` job env 块没有这一行。`golden-path-2-smoke.sh` 会在两条车道都被扫描到并执行，但在 glob-runner 车道每次都在 Step 8c（真调判定）因 `no_api_key` 真红——因为该脚本不在 `smoke-baseline.txt` 棘轮闸名单内，这个红只报 `::warning::` 不阻断 CI，等于 glob-runner 车道上 GP2 的 Step 9-32 从未真正执行过。08-04 main run 30905835428 已实锤复现（"存量债 smoke golden-path-2-smoke.sh FAIL (exit 8)"）。

**方案**：
1. 在 `smoke-glob-runner` job 的 env 块补 `TOAPIS_API_KEY: ${{ secrets.TOAPIS_API_KEY }}`（照抄 l4 车道写法）
2. 核对 glob-runner 车道和 l4 车道其余 env 差异（`SERVER_LOG`、DB 连接串变量名等），补齐 `golden-path-2-smoke.sh` 需要的其余变量（脚本 Step 23a 读 `SERVER_LOG` 环境变量指向 server stdout 重定向文件，需要确认 glob-runner job 的 "Start apps/api" 步骤是否已经把 stdout 重定向到某个路径并设了该变量——若没有，Step 23a 会在 glob-runner 环境里跳不过去，需要一并补上）
3. 补齐后本地/CI 实测确认 GP2 能在 glob-runner 环境下 32 步全绿
4. 全绿后把 `golden-path-2-smoke.sh` 加入 `smoke-baseline.txt`（进入棘轮闸，此后 FAIL 才会真正阻断 CI）

**测试**：先证明现状会红（08-04 run 30905835428 是现成证据，PR 描述引用即可，不需要额外复现）；改完后的转绿证据 = 该 PR 自己触发的 glob-runner CI 运行本身（这条 workflow 会在 PR 上跑，直接看这次 PR CI 结果）。

### 组件 3：`line02-android-collect-realmachine-smoke.sh` xargs 剥引号 bug

**根因**：第 182-195 行左右，`ssh hk-vps "psql ... json_agg(...)" | tr -d '\n' | xargs` 用 xargs 做"trim 首尾空白"，但 xargs（不带参数）执行的是标准 shell-word-splitting + quote-removal 语义，会把 JSON 输出里的双引号全部剥掉。本地已复现：`echo '[{"nickname":"张三"}]' | tr -d '\n' | xargs` 输出 `[{nickname:张三}]`，丢失了全部双引号。后续 `JSON.parse(data.trim())` 遇到这种输入必然抛异常。这个分支只有在真机采集产出 ≥1 个 matched 视频（即 Seg3/4 被触发）时才会执行到，近期真机 CI 绿跑记录都是 cancel 场景（collect job skipped），怀疑这条路径从未在生产环境被真实跑到过。

**方案**：去掉 `| xargs`，改用不改变内容的 trim 方式：
```bash
LEADS_JSON=$(ssh hk-vps "..." | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
```
`sed` 只做首尾空白裁剪，不触碰引号/内容。同时检查第 143-208 行范围内其余 `node -e` 管道（`QUALITY_RESULT`/`PROFILE_URL_COV` 那几行）是否有同款隐患——这几行走的是 `echo "$QUALITY_RESULT" | node -e "..."`，QUALITY_RESULT 本身是脚本内部 `checkLeadQuality` 的输出（`JSON.stringify` 结果，来源可控，不经过 ssh/xargs），确认无需修改。

**测试**：写一个可复现的最小脚本级测试（bash + node，放在 `.github/workflows/scripts/smoke/lib/` 下一个新的测试脚本文件），断言：
1. `echo '[{"nickname":"张三","comment_text":"求报价"}]' | tr -d '\n' | xargs` 的结果**无法**被 `JSON.parse` 正确解析（先证明现状会炸——failing test）
2. 改用 `sed` trim 后同一断言能正确解析出 `nickname` 字段值 `"张三"`
此测试 commit 进 repo，接入 `ci-smoke-glob-runner.yml`（或独立作为一个新的 smoke 脚本被 glob-runner 自动发现执行），防止未来有人把 trim 写法改回 xargs。

## 测试策略

- **组件 1（环境接缝）**：无 CI test；proven-to-fire = 手动 workflow_dispatch 一次，PR 描述附运行证据。
- **组件 2（环境+配置接缝）**：无独立单测；proven-to-fire = 本 PR 自身触发的 glob-runner CI 运行结果（改动前已有现成的红证据）。
- **组件 3（逻辑接缝）**：CI test，先写 failing test 证明现状会炸（commit-1），改代码让其转绿（commit-2），永久留在 CI 里跑防回归。

## 范围边界

不包含（另立/延后）：
- P0-4（nightly 连红 19 晚零信号消费的设备侧 initAgent 自愈）——组件 1 落地后作为验证性任务观察，不在本次代码修复范围内，结果记录进 PR 描述 + memory。
- P1 六条（Step 26/28 空断言、Seg3 收尾误导性输出、ssh 失败误分类、pc4 设备发现去重、Android CI 进 required checks）——按用户指示排在本批次之后处理，另开 PR。

## 影响范围

三处改动均为 CI workflow 配置 + 一个真机 smoke 脚本的 trim 写法，不触碰任何生产业务代码（apps/api、services/agent-android 等），不改变 API 契约、不改变数据库 schema，风险面局限于 CI/CD 车道本身。
