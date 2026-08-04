# Bug PrepPRD：安卓智能获客(line02) golden path smoke 三处守卫失效（P0批次）

## 症状
08-04 夜连夜审计 `golden-path-2-smoke.sh` 及配套 CI/真机车道，发现三个独立但都属于"守卫本身失效"的问题：
1. `e2e-line02-android-collect.yml`（rog 真机采集 nightly，每晚北京04:00）checkout 阶段裸 `actions/checkout@v4`，近几晚被出境网络断连卡死在 git fetch，nightly 从未真正跑到脚本本体。
2. `ci-smoke-glob-runner.yml`（PR required check）环境缺 `TOAPIS_API_KEY`，导致 `golden-path-2-smoke.sh` 每次 PR 都在 Step 8c 因 `no_api_key` 真红，但因该脚本不在 `smoke-baseline.txt` 棘轮闸内，被当存量债只报 warning、不阻断——等于这个 required check 车道上 GP2 从 Step 9 到 Step 32 从未真正执行过。
3. `line02-android-collect-realmachine-smoke.sh` 里 Seg3 语义质量闸从 `ssh hk-vps` 取 leads JSON 后经过 `tr -d '\n' | xargs`，`xargs` 的 shell 分词语义会把 JSON 里的双引号全部剥掉，后续 `JSON.parse` 必然抛异常——只要真机采到 matched 视频、走到这个分支就会崩。

## 根因假设
1. checkout 网络修复此前只推到 `nightly-real-machine-staging.yml` / `nightly-android-fleet-pc4.yml`（PR#1590/#1592/#1593/#1602），没有同步搬到 `e2e-line02-android-collect.yml`——三条 nightly workflow 独立维护，缺少统一模板/复用导致修复没有覆盖全部车道。
2. `ci-smoke-glob-runner.yml` 和 `ci-l4-e2e-smoke.yml` 是两条独立起 apps/api 的 CI 车道，前者的 env 块是后来按需逐条搬运的，`golden-path-2-smoke.sh` 加入 glob 车道扫描范围时没有人核对它需要的全部密钥（TOAPIS_API_KEY 只在 l4 车道 env 里）。
3. `xargs`（不带参数）会做 shell-word-splitting + quote removal，这是 xargs 的标准语义，用来做"trim 首尾空白"是误用——只有输入不含引号/特殊字符时才凑巧不出问题，一旦输入是带双引号的 JSON 立刻炸。

## 关联上下文
- 相关 Journey：line02 智能获客（Path 2）
- 相关历史决策：431acd2c（去飞书改本地中台）、2f11ae25（envfail 与真机验证失败同级处理约定）
- 姊妹 PR：#1590/#1592/#1593（pc4 车道 checkout 网络修复）、#1602（staging 车道同款修复，in-flight）
- 完整审计详情见 memory `handoff_0804_gp2_android_smoke_audit_18_findings.md`

## 修法
1. **`.github/workflows/e2e-line02-android-collect.yml`**：checkout 步骤改用 sparse-checkout 缩小拉取范围，并按 pc4/staging 车道同款模式加临时 HK exit-node 兜底出境断连（参照 PR#1592/#1602 的具体 diff）。
2. **`.github/workflows/ci-smoke-glob-runner.yml`**：在 job env 块补 `TOAPIS_API_KEY: ${{ secrets.TOAPIS_API_KEY }}`（同 `ci-l4-e2e-smoke.yml` 第90行）；实测 `golden-path-2-smoke.sh` 在 glob-runner 环境下能否全 32 步通过（注意两条车道 env 命名差异，比如 `SERVER_LOG`/DB 连接串变量名可能不完全对齐，需要核对补齐）；确认全绿后把该脚本加入 `smoke-baseline.txt` 棘轮闸。
3. **`.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`**：去掉 `| xargs` 的 trim 用法，改用不改变内容的 trim 方式（如 `sed`），保证 ssh 取回的 JSON 原样传给 `JSON.parse`。
4. P0-4（nightly 连红 19 晚零信号消费）不是独立代码修法，而是验证性任务：P0-1 落地后观察下一轮 nightly（或手动 workflow_dispatch 一次）是否至少能跑过 checkout 阶段；若仍是 envfail exit3（设备侧 initAgent 问题），在 PR 描述/memory 里记录清楚，判断是否需要挂 `[nightly-red]` 消费闭环（若已存在同款机制），不在本批次强修设备侧自愈。

## Regression Test 计划
- **checkout 修复**：无法用传统 unit test 复现网络断连，采用与 PR#1590/#1592/#1593/#1602 同款验证方式——workflow 语法正确性 + 手动 `workflow_dispatch` 触发一次验证能跑过 checkout 阶段（环境类守卫，非 CI test）。
- **TOAPIS_API_KEY 缺失**：**先证明现状会红**——在本地或临时分支上，用 glob-runner 当前 env（不含 TOAPIS_API_KEY）跑一次 `golden-path-2-smoke.sh` 的 Step 8c，确认复现 `no_api_key` 真红；补上 key 后同一环境应通过。这一步无法作为 CI test 常驻（key 本身是密钥），但作为验证证据留在 PR 描述里；`golden-path-2-smoke.sh` 本身已是永久 regression test（进 baseline 后棘轮闸生效）。
- **xargs JSON 剥引号 bug**：写一个脚本级最小复现测试（bash 脚本或 node 脚本均可，建议放进 `.github/workflows/scripts/smoke/lib/` 或作为独立 test 文件），断言 `echo '[{"nickname":"张三"}]' | tr -d '\n' | xargs` 的结果无法被 `JSON.parse` 解析（先证明会炸），改用 `sed` trim 后同一断言应能正确解析出 `nickname":"张三"`。此测试须 commit 进 repo 并接入某条会跑的 CI 车道（或作为 shellcheck/单测形式），防止未来有人把 trim 写法改回 xargs。

> ⚠️ 按守卫死规矩：checkout 修复 + TOAPIS key 属于**环境接缝**，用"实测验证 + PR 描述留证据"作为 proven-to-fire 证明（故意在旧配置下跑一次看它真红，再上新配置看它真绿）；xargs bug 属于**逻辑接缝**，用 CI test 常驻守。

## 验收标准
- [ ] xargs bug 的 failing test 先 commit（commit-1），证明 `tr -d '\n' | xargs` 破坏 JSON
- [ ] 三处修复代码分别让对应验证转绿（commit-2 起）
- [ ] `golden-path-2-smoke.sh` 加入 `smoke-baseline.txt` 前已实测在 glob-runner 环境全 32 步通过
- [ ] `e2e-line02-android-collect.yml` 手动 workflow_dispatch 一次验证 checkout 不再是瓶颈（P0-4 验证性任务）
- [ ] CI 全绿
