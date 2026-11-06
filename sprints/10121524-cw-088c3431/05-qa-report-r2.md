---
task_id: 088c3431-57ca-4f2a-8a50-14601518e2a2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 2 轮，环境：PR worktree 本地黑盒）

| 项目 | 结果 |
|---|---|
| 本地黑盒验收 | PASS；7 条 T、1 条 X 全部通过 |
| 时序场景 | 完整运行两轮，一致 |
| 基线 | 合同固定 efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15 |
| 边界 | 无生产、网络、真机、真实账号调用；未运行单元测试 |

所有条目均以自建临时源码树替代真实应用数据，无外部服务依赖。probe.mjs 仅造输入、真实启动 CLI 并检查进程输出，不复制扫描算法、不引入测试框架；任一断言失败使命令非零。子进程 timeout 为 10 秒。JSON 中 stdout/stderr 是原样捕获后的 JSON 编码（换行显示为 \\n）；status 为实际 CLI 退出码。各数据目录 finally 清理。执行驱动及基线副本保存在 qa-r2，全部原始输出另存 records.json。

基线对象只读解析记录（退出码 0）：
```command
git rev-parse --verify 'efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15^{commit}'
```
```output
efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15
```

基线仅提取场景所需单文件，未读取基线开发回执（退出码 0）：
```command
git show efaa9152a621cbdb7a8e2dfbc269cc9743f0fd15:scripts/check-staff-hub-llm-imports.mjs > /tmp/cw-088c3431-qa-r2-T5OdG8/baseline.mjs && shasum -a 256 /tmp/cw-088c3431-qa-r2-T5OdG8/baseline.mjs
```
```output
ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555  /tmp/cw-088c3431-qa-r2-T5OdG8/baseline.mjs
```

### T-1
对应: Q-1
verdict: PASS

两个最小案例及 24 个独立组合全部阻断；逐项断言退出码、signal/error、完整文件路径、模块及输出。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q1
```
```output
{"label":"minimal mjs","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-UAnaUj/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"minimal cjs","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-uwTNP4/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"mjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-Uw9hZK/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-QuuO2r/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-MWIzqL/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-XagXj7/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-mXN35t/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-5Sofc2/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-yHP92c/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-ILxRVI/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-AQLjBN/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-Hj7Vn7/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-6Jhypd/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-FReyg9/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"cjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-G7uzvg/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-QiMAmI/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-Umjrmn/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-pxDWXd/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-XMI6lL/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-LwGSrE/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-XINBiH/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-5VaXnl/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-kjZrgo/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-wSYJOJ/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-yhOC8D/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q1-fOTuMy/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
```

### T-2
对应: Q-2
verdict: PASS

四种旧扩展名各自阻断，覆盖为允许模块后恢复；六种扩展名允许文本一起通过。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q2
```
```output
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q2-ar9utv/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q2-sWEqTY/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q2-CTP7V3/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q2-ZgApoO/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-3
对应: Q-3
verdict: PASS

四个排除目录各放两种禁用文件，首次通过；普通 src 新增文件后只报告两条可见命中。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q3
```
```output
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible added","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q3-z0jBhU/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q3-z0jBhU/apps/staff-hub/src/visible.mjs: openai\n"}
```

### T-4
对应: Q-4
verdict: PASS

缺失目录准确报错；空目录、两个空文件通过。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q4
```
```output
{"label":"missing","status":1,"signal":null,"error":null,"stdout":"","stderr":"apps/staff-hub not found\n"}
{"label":"empty directory","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"empty files","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

### T-5
对应: Q-5
verdict: PASS

时序场景第 1 次：连续两次、并发两次均阻断；一 MiB 末尾命中、重复模块去重；逐字节验证文件未被扫描修改，修正后恢复。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q5
```
```output
{"label":"serial 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"serial 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-uCkD4r/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
source bytes unchanged before correction: true
```

### T-6
对应: Q-5
verdict: PASS

时序场景第 2 次：重新造目录，重复全部操作；结果与第 1 次一致，无 FLAKY。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q5
```
```output
{"label":"serial 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"serial 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 1","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"concurrent 2","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/long.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q5-yEhcaY/apps/staff-hub/src/repeat.mjs: openai\n"}
{"label":"corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
source bytes unchanged before correction: true
```

### T-7
对应: Q-6
verdict: PASS

固定基线和 PR 各用全新 Q-1/Q-2/Q-3 数据运行。基线漏扫新扩展名，PR 全部阻断；旧扩展名、允许输入及排除目录结果符合契约。基线额外用普通目录 .js 命中作进入目录的对照。静态核对测试文件实际存在且匹配 CI 命令的 glob。历史时序按 02-spec.md 的 commander 补充分工归独立历史门，本轮不作历史通过声明。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs q6
```
```output
baseline SHA256: ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555
CLI: /private/tmp/cw-088c3431-qa-r2-T5OdG8/baseline.mjs
{"label":"minimal mjs","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"minimal cjs","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from 'openai';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require('openai');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from \"openai\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require(\"openai\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from 'anthropic';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require('anthropic');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from \"anthropic\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require(\"anthropic\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from '@anthropic-ai/sdk';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require('@anthropic-ai/sdk');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs import client from \"@anthropic-ai/sdk\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"mjs const client = require(\"@anthropic-ai/sdk\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from 'openai';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require('openai');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from \"openai\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require(\"openai\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from 'anthropic';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require('anthropic');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from \"anthropic\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require(\"anthropic\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from '@anthropic-ai/sdk';","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require('@anthropic-ai/sdk');","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs import client from \"@anthropic-ai/sdk\";","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"cjs const client = require(\"@anthropic-ai/sdk\");","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-weJrlF/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-t6s56W/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-bbmVDK/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-5J2RhJ/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible added","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"baseline ordinary directory control","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-54ntV3/apps/staff-hub/src/visible.js: openai\n"}
CLI: /Users/administrator/worktrees/zenithjoy-cw/qa-2132-2/scripts/check-staff-hub-llm-imports.mjs
{"label":"minimal mjs","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-YmjzNw/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"minimal cjs","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-5nK6BI/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"mjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-jk505X/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-KBqKoJ/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-sxTJrq/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-AAk3iw/apps/staff-hub/src/sample.mjs: openai\n"}
{"label":"mjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-dpXiPm/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-3Zfo8B/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-6hPPXv/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-SsMEl1/apps/staff-hub/src/sample.mjs: anthropic\n"}
{"label":"mjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-4Wx9Kz/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-m724Vb/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-AWxsAR/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"mjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-oywis8/apps/staff-hub/src/sample.mjs: @anthropic-ai/sdk\n"}
{"label":"cjs import client from 'openai';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-N7CTF8/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs const client = require('openai');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-HIqNxz/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs import client from \"openai\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-p3uiOQ/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs const client = require(\"openai\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-TJJvQ8/apps/staff-hub/src/sample.cjs: openai\n"}
{"label":"cjs import client from 'anthropic';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-3rcWNn/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs const client = require('anthropic');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-6Re11k/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs import client from \"anthropic\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-v6lqkd/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs const client = require(\"anthropic\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-RK9oMU/apps/staff-hub/src/sample.cjs: anthropic\n"}
{"label":"cjs import client from '@anthropic-ai/sdk';","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-IAAd60/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs const client = require('@anthropic-ai/sdk');","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-LiRYdx/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs import client from \"@anthropic-ai/sdk\";","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-nSylAj/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"cjs const client = require(\"@anthropic-ai/sdk\");","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-WYY4SX/apps/staff-hub/src/sample.cjs: @anthropic-ai/sdk\n"}
{"label":"js banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-GD3lQy/apps/staff-hub/sample.js: openai\n"}
{"label":"js corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"ts banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-2MpdjG/apps/staff-hub/sample.ts: openai\n"}
{"label":"ts corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"tsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-Y76EIU/apps/staff-hub/sample.tsx: openai\n"}
{"label":"tsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"jsx banned","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-AiHhlt/apps/staff-hub/sample.jsx: openai\n"}
{"label":"jsx corrected","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"six allowed","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"excluded only","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
{"label":"visible added","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-3OQBdR/apps/staff-hub/src/visible.cjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-q6-3OQBdR/apps/staff-hub/src/visible.mjs: openai\n"}
CI actual command:         run: node --test scripts/openclaw/**/*.test.js services/phone-adb-controller/__tests__/*.test.mjs .github/workflows/scripts/__tests__/*.test.mjs
glob collected file: .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs
```

### X-1
对应: Q-1,Q-2
场景: 中文空格路径、多模块去重、语法错误与不执行源码
verdict: PASS

中文及空格路径、同文件多个模块、重复模块去重均正确；随后覆盖为含语法错误和 throw 的允许模块文本，仍通过，说明扫描未执行源码。

替身与边界: 临时源码树；真实运行本地 CLI，无第三方链路需要替身之外验证。
命令退出码: 0

```command
node /tmp/cw-088c3431-qa-r2-T5OdG8/probe.mjs explore
```
```output
{"label":"unicode path multiple modules deduplicated","status":1,"signal":null,"error":null,"stdout":"","stderr":"/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-explore-ADh4XV/apps/staff-hub/含 空格/报错.mjs: openai\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-explore-ADh4XV/apps/staff-hub/含 空格/报错.mjs: anthropic\n/private/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cw-088c3431-qa-explore-ADh4XV/apps/staff-hub/含 空格/报错.mjs: @anthropic-ai/sdk\n"}
{"label":"invalid syntax is only text","status":0,"signal":null,"error":null,"stdout":"OK\n","stderr":""}
```

