---
task_id: 088c3431-57ca-4f2a-8a50-14601518e2a2
step: build
upstream: ["02-spec.md#S-1","02-spec.md#S-2","02-spec.md#S-3","02-spec.md#S-4"]
---

### B-1
对应 S-1。修改 `scripts/check-staff-hub-llm-imports.mjs`，仅把扩展名正则补入 mjs/cjs；禁模块、文本匹配、目录排除逻辑未改变。
新增测试文件 `.github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`，24 个独立用例覆盖两种新增扩展名 × 三个禁模块 × 四种写法，精确检查退出码、标准输出及完整诊断路径。
实际命令：`node --test .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`。
未修 CLI 首次运行，新增扩展名阻断断言为 actual 0、expected 1；最终固定基线复验该 24 项同样失败，当前实现该 24 项全通过。完整套件结果见 B-4。
提交 SHA：`ee9ffd34834d8f5affff468d16e1f5ad8a1ff63e`（测试与实现同一提交）。

### B-2
对应 S-2。修改文件：上述新增测试文件；实现复用 S-1。
新增 48 个旧扩展名阻断用例、6 个允许模块用例，以及缺失目录、空目录/空文件检查。扫描文本含不合法重复声明与 throw，仍通过允许用例，证明未执行输入。
实际命令：`node --test .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`。
修正测试路径后，固定基线的上述 56 项通过，当前实现同样通过。S-2 是既有行为回归，没有人为制造旧行为失败。
提交 SHA：`ee9ffd34834d8f5affff468d16e1f5ad8a1ff63e`。

### B-3
对应 S-3。修改文件：上述新增测试文件；目录排除实现原样保留。
新增 8 个目录排除/普通 src 对照用例，覆盖根层及嵌套 node_modules、dist 与 mjs/cjs；新增重复命中去重、多模块、一 MiB 文本末尾、连续和并发运行、只读及修正恢复用例。
每例使用含 088c3431 的随机临时目录，以 realpath 规范化 macOS 临时目录路径，通过 t.after 清理。只使用 Node 内置模块及合成文件树。
实际命令：`node --test .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`。
固定基线中 8 个普通 src 对照和 1 个复合用例因 exit 0 而非 1 失败；当前实现全部通过，排除目录诊断不会出现。
提交 SHA：`ee9ffd34834d8f5affff468d16e1f5ad8a1ff63e`。

### B-4
对应 S-4。修改文件：上述新增测试文件；测试通过 import.meta.url 定位真实 CLI，用 process.execPath 启动，明确断言 error、signal、status。并发进程同样检查出口。未修改工作流、注册表、版本号或产品文件。
提交 SHA：`ee9ffd34834d8f5affff468d16e1f5ad8a1ff63e`。

实际测试命令（以下四次完全相同）：
```sh
node --test .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs
```

解释器：`/opt/homebrew/Cellar/node/26.8.2/bin/node`，`v26.8.2`。

| 实际阶段 | UTC 开始—结束 | exit | 结果 |
|---|---|---|---|
| 首次未修 CLI | 2026-10-12T07:31:50.654395+00:00 — 2026-10-12T07:31:53.290633+00:00 | 1 | 89 项：8 通过、81 失败；skip/cancel 均 0 |
| 首次正则修复后 | 2026-10-12T07:32:06.607618+00:00 — 2026-10-12T07:32:09.411502+00:00 | 1 | 89 项：8 通过、81 失败；skip/cancel 均 0 |
| 修正测试路径后的固定基线 | 2026-10-12T07:32:33.568487+00:00 — 2026-10-12T07:32:36.127733+00:00 | 1 | 89 项：56 通过、33 失败；skip/cancel 均 0 |
| 修正测试路径后的当前实现 | 2026-10-12T07:32:36.127942+00:00 — 2026-10-12T07:32:38.740738+00:00 | 0 | 89 项：89 通过、0 失败；skip/cancel 均 0 |

首次运行先于实现修改，mjs/cjs 的失败确实为退出码断言 `0 !== 1`。但旧扩展名诊断比较也因 macOS `/var` 与进程 cwd 的 `/private/var` 路径别名失败，因此首次红态不作为完整验收通过证据。首次实现修复后暴露同一路径问题，随后只对测试创建目录调用 fs.realpathSync，未扩大实现范围。

最终测试使用固定真实起点 `efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15`（`git rev-parse --verify 'HEAD^{commit}'` 在提交前验证），通过 `git show <SHA>:scripts/check-staff-hub-llm-imports.mjs` 导出原始 CLI，连同相同永久测试放入 `/tmp/cw-088c3431-baseline-px1u2r9v` 的对应相对路径，实际运行固定基线红态，再运行当前工作树绿态。未覆盖当前实现，未手工修改基线。此为 build 的补充复验，不冒充独立 QA 的 Q-6 全量 git archive 验收。

- 原始 CLI SHA256：`ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555`。
- 修复 CLI SHA256：`ddfa6dad60e264c135f51442adc5f2abb23ba24583d89106591e632566a771be`。
- 最终红态失败用例：mjs/cjs 各 12 项阻断矩阵、8 项排除目录后的普通 src 对照、1 项重复/大文件复合用例。全部是 `CLI 退出码`，`actual: 0, expected: 1, operator: strictEqual`。例如 `mjs 阻断 openai（单引号 import）`、`cjs 阻断 anthropic（单引号 require）`。
- 原始输出与启动元数据：`/tmp/cw-088c3431-build-vx05bfo9/{red,initial-after-change,baseline-red,green}.{log,json}`。临时证据不提交；摘要保存在本回执。

实际静态检查：
```sh
rg -n 'node --test|openclaw-scripts-test' .github/workflows/ci-l3-code.yml
rg -n 'test.mjs|orphan|test\.ts' .github/workflows/ci-l2-consistency.yml
npm run product-map:check
git diff --check
```
输出摘要：L3 第 243 行既有命令包含 `.github/workflows/scripts/__tests__/*.test.mjs`，新增文件是该目录直接子文件；L2 第 159 行只登记 test/spec 的 ts/tsx/js，不包含 mjs。product-map 检查 exit 0，`PASS: no drift`；diff 检查 exit 0、无输出。未运行包含设备相关套件的 CI 全量命令。

提交前检查：只有本次 CLI 与测试进入暂存区，`git diff --name-only` 为空；预先存在的未跟踪 sprint 目录保留。提交只含这两个文件，未提交 sprint 内任何文件。本回执在提交之后创建并保持未提交。未 push、未开 PR、未调用 gh、未切换分支、未改生产数据或操作真机。

执行者：Codex build。后续独立 verify、local QA、远端 CI 和最终裁判由 runner 执行，本回执不宣称这些已完成。
