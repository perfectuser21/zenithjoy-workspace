---
task_id: 088c3431-57ca-4f2a-8a50-14601518e2a2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 1 轮，环境：PR worktree 本地黑盒）

| 范围 | 结果 |
|---|---|
| Q-1～Q-4 | PASS |
| Q-5 | 两轮 PASS；无 FLAKY |
| Q-6 | CANNOT_VERIFY；基线对照与 CI glob 已核验，开发时先红后绿未核验 |
| 探索 | PASS；未发现产品缺陷 |
| 总结 | 交给人判断，不宣告整轮通过 |

运行环境：Node v26.8.2。所有业务操作通过 QA 自建的 blackbox.mjs 启动真实 CLI 子进程；未调用任何测试运行器。脚本仅造文件、调用 CLI、捕获输出并断言，不实现扫描逻辑。每次检查 status、signal、error、stdout 和诊断行的精确集合；断言失败会非零退出。JSON 行内 stdout/stderr 是子进程原始输出的转义记录。

替身：只用系统临时目录内的合成 apps/staff-hub 文件树，无 SDK 安装、服务、网络、设备或真实账号。每例 finally 清理。未验远端 CI、发布或设备链路；本任务 CLI 无这些运行依赖。QA 辅助脚本及输出保存在 qa-r1。初次辅助脚本因 macOS /var 到 /private/var 的路径别名出现断言失败，已用 realpath 规范化临时根并完整重跑；这是 QA 路径构造问题，不计为产品缺陷。

### T-1
对应: Q-1
verdict: PASS
场景: 24 个独立单文件目录覆盖两种新扩展名 × 三个禁模块 × 两种引号 × import-from/require；包括合同指定的两个示例。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q1
```
```output
{"label":"PR mjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-6rSfPm/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-s5hVJV/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-6kO0tn/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-cUOdv3/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-WdqFk0/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-Uo7Nvf/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-92evgR/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-MjIl3W/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-bqqiAo/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-Db3Ka9/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-ya4E7h/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-HHOMCN/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-3eFyGi/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-ITPySt/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-7dHfyu/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-0Hjjvv/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-P3BfmT/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-q8Mpc6/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-tvC84E/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-zBKPLo/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-Ww3yZT/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-8vqpHq/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-ajH6LT/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-GWKtq8/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
```

### T-2
对应: Q-2
verdict: PASS
场景: 四种旧扩展名分别先阻断再覆盖修正；另造六种扩展名允许模块文件一起通过。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q2
```
```output
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-IDUD7J/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-LsZvOn/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-PhBJsv/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-EyS9aX/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"all six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-3
对应: Q-3
verdict: PASS
场景: 根层与嵌套 node_modules/dist 同时放两种禁模块文件；检查排除、普通目录新增命中和旧扩展名控制组。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q3
```
```output
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible new extensions","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-FeF34O/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-FeF34O/apps/staff-hub/src/visible.mjs: openai\n"}
{"label":"visible old extension control","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-FeF34O/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-FeF34O/apps/staff-hub/src/visible.js: openai\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-FeF34O/apps/staff-hub/src/visible.mjs: openai\n"}
```

### T-4
对应: Q-4
verdict: PASS
场景: 同根依次检验缺失应用目录、空应用目录、两个空文件。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q4
```
```output
{"label":"missing app","status":1,"signal":null,"error":null,"stdout":"","stderr":"apps/staff-hub not found\n"}
{"label":"empty app","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"empty files","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-5
对应: Q-5
verdict: PASS
场景: 第一轮：两次串行、两个并发进程、修正后重跑；检查 1 MiB 文本末尾、诊断去重及文件字节未变化。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q5
```
```output
{"label":"sequential 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"sequential 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-h5tzr5/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-6
对应: Q-5
verdict: PASS
场景: 第二轮：重新造独立目录，完整重复相同串行/并发/修正操作。两轮结果一致。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q5
```
```output
{"label":"sequential 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"sequential 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q5-oMYu0e/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-7
对应: Q-6
verdict: CANNOT_VERIFY
原因: Q-6 要求检查 build 回执中的永久测试先红后绿时序、失败断言和无 skip/cancel；本轮明确禁止读取 03/04 等开发方文件，也禁止以单元测试作 QA 证据。因此未读取回执、未运行永久测试，当前行为对照不能证明历史实施时序；须由编排者或人独立复核。此项不降格为 PASS。
场景: 从合同指定 origin/main 解析并固定 efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15，提取的 CLI SHA256 与合同记录一致。对两版各自新建 Q-1/Q-2/Q-3 文件树，直接运行 CLI；基线漏扫两种新增扩展名，PR 全部阻断，旧扩展名、允许输入、排除目录一致。读取新增永久测试及工作流，断言实际 CI 命令与 glob 匹配。
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs Q6
```
```output
{"baseline":"efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15","sha256":"ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555","node":"/opt/homebrew/Cellar/node/26.8.2/bin/node","version":"v26.8.2"}
{"label":"baseline mjs import client from 'openai';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require('openai');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs import client from \"openai\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require(\"openai\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs import client from 'anthropic';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require('anthropic');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs import client from \"anthropic\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require(\"anthropic\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs import client from '@anthropic-ai/sdk';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require('@anthropic-ai/sdk');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs import client from \"@anthropic-ai/sdk\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline mjs const client = require(\"@anthropic-ai/sdk\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from 'openai';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require('openai');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from \"openai\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require(\"openai\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from 'anthropic';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require('anthropic');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from \"anthropic\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require(\"anthropic\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from '@anthropic-ai/sdk';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require('@anthropic-ai/sdk');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs import client from \"@anthropic-ai/sdk\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline cjs const client = require(\"@anthropic-ai/sdk\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"PR mjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-NMPxhN/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-lE7VuS/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-IQynno/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-O9NRjP/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"PR mjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-e9BgjN/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-kLAufd/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-EAkT7H/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-AzwKZr/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"PR mjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-KlLaLO/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-XQIDgk/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-CRjtHD/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR mjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-EZkaoE/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-mzmoZo/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-H2HA4M/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-h8Ue2o/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-XGawVU/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"PR cjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-LoflWi/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-JmQO25/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-QPtAjI/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-0VyX1K/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"PR cjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-KXIiuD/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-1LwboL/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-z8SPER/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"PR cjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q1-9k5MVn/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-WcdPku/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-zxT2om/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-O30iUU/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-iiPrZA/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"all six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-6j5WvG/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-mKykbW/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-H95hTT/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q2-zYlZR5/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"all six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible new extensions","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible old extension control","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-WItX3R/apps/staff-hub/src/visible.js: openai\n"}
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible new extensions","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-pMNRzc/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-pMNRzc/apps/staff-hub/src/visible.mjs: openai\n"}
{"label":"visible old extension control","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-pMNRzc/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-pMNRzc/apps/staff-hub/src/visible.js: openai\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-Q3-pMNRzc/apps/staff-hub/src/visible.mjs: openai\n"}
{"test":".github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs","bytes":5399,"ciCommand":"run: node --test scripts/openclaw/**/*.test.js services/phone-adb-controller/__tests__/*.test.mjs .github/workflows/scripts/__tests__/*.test.mjs","globMatched":true}
```

### X-1
对应: Q-1,Q-2
场景: 用户目录包含会抛异常且语法非法的文本；确认仅扫描不执行，随后同文件放两个禁模块，分别报告。
verdict: PASS
辅助命令退出码: 0
```command
node sprints/10121524-cw-088c3431/qa-r1/blackbox.mjs X1
```
```output
{"label":"invalid syntax scanned without execution","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"multiple modules same file","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-X1-YfCwLB/apps/staff-hub/src/never-execute.mjs: openai\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-X1-YfCwLB/apps/staff-hub/src/never-execute.mjs: anthropic\n"}
```

基线准备：只读解析使用的完整命令如下，输出节选保留实际 SHA；01 明确本次从 origin/main 开始，Q-6 明确允许使用该 ref。后续提取只用此完整 SHA。
```command
cat AGENTS.md && git rev-parse --verify 'origin/main^{commit}' && node --version && sed -n '1,160p' scripts/check-staff-hub-llm-imports.mjs
```
```output
efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15
v26.8.2
```

基线提取命令（退出码 0；输出节选）：
```command
D=$(mktemp -d /tmp/cw-088c3431-qa-baseline-XXXXXX) && git archive efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15 scripts/check-staff-hub-llm-imports.mjs | tar -x -C "$D" && shasum -a 256 "$D/scripts/check-staff-hub-llm-imports.mjs" && cat "$D/scripts/check-staff-hub-llm-imports.mjs"
```
```output
ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555  /tmp/cw-088c3431-qa-baseline-HKTU2H/scripts/check-staff-hub-llm-imports.mjs
```

