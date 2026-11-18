---
task_id: 088c3431-57ca-4f2a-8a50-14601518e2a2
step: intent
upstream: []
---
# Z0 金丝雀：修复 staff-hub LLM import 守卫漏扫 .mjs/.cjs

## 背景

C7 金丝雀。纯 Node CLI 单文件缺陷：scripts/check-staff-hub-llm-imports.mjs 仅扫描 ts/tsx/js/jsx，导致 .mjs/.cjs 中相同 banned import 漏检。沙箱已复现：sample.js 引入 openai 则 exit1；相同内容 sample.mjs/sample.cjs 则 exit0。只修改此 CLI 与纯 Node 回归测试；不碰产品 UI、真机、生产、phone-adb，不合并 PR。

阶段边界：acceptance 仅为产 PR 前可本地验收的行为。最终交付仍必须真实产 ZenithJoy PR、实际远端必需 CI 全绿、local QA 与独立 ToAPIs 裁判通过，并停 awaiting_human；严禁合并。这些由 runner 后续 PR/CI/QA/judge 门禁验证，不能在 pre-PR verify 阶段要求尚未创建的远端产物，也不能将本地 PASS 冒充最终交付。

上一真实运行387cb817已失败保留（非复用其通过状态）：spec_review FORCED/R-1；build真实先红后绿；verify原生命令证据解析失败且旧I4/I5阶段冲突。此次从实际origin/main基线重新执行，旧实现未合并。规格阶段无shell，因此引用以下已存在真实预跑事实供合同审查，永久测试创建与本次红绿再跑在 build 第一项完成，不声称新任务尚不存在的测试已执行：Node v26.8.2 /opt/homebrew/Cellar/node/26.8.2/bin/node；旧CLI SHA256 ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555；真实独立CLI子进程mjs禁模块exit0、cjs禁模块exit0、js禁模块exit1、允许模块exit0。上一轮新永久测试在未修CLI上83项55过28失败/exit1，修后83全过/exit0，cancelled/skipped为0；这只是前轮验证命令可启动与缺陷有效的预跑证据，不替代本次QA。原始证据在父任务C7与387cb817回执、持久c7-z0-build-evidence中，可由编排者独立复核。

### I-1
临时 apps/staff-hub 下 .mjs 引入 openai、.cjs require anthropic 均退出非0并报告文件与模块；通过 spawn CLI 黑盒断言。

### I-2
保留 js/ts/tsx/jsx 既有检查，正常非禁模块文件返回 OK/exit0。

### I-3
node_modules 与 dist 仍跳过；在临时沙箱验收，不依赖本机状态、不发请求、不碰 UI/真机。

### I-4
新增永久纯 Node .test.mjs，先在未修CLI上取得真实断言红态，再在修后取得绿态；独立verify可在临时目录用基准源码复验红绿。静态核CI实际调用glob涵盖新测试，本条不把尚未创建PR的远端CI结果作为pre-PR条件。
