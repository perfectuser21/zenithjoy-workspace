---
task_id: 088c3431-57ca-4f2a-8a50-14601518e2a2
step: spec
upstream: ["01-intent.md#I-1","01-intent.md#I-2","01-intent.md#I-3","01-intent.md#I-4"]
---

### S-1
对应：I-1。

修改文件：`scripts/check-staff-hub-llm-imports.mjs`；配套新增 `.github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`。

仅将 `walk()` 的扩展名正则由 `/\.(ts|tsx|js|jsx)$/` 扩为 `/\.(ts|tsx|js|jsx|mjs|cjs)$/`。继续使用现有禁模块集合 `openai`、`anthropic`、`@anthropic-ai/sdk`，以及单/双引号的 `from '模块'`、`require('模块')` 四种字符串匹配；不引入解析器，不扩展匹配语法。

真实调用方 shape：现有脚本入口是 Node CLI，`node scripts/check-staff-hub-llm-imports.mjs`，无参数，`process.cwd()` 是仓库根，输入是该根下 `apps/staff-hub` 文件树；无 HTTP 方法、路径、header、body 或鉴权。出处：该脚本的 ROOT、appDir 和顶层执行代码。已读取的根及 staff-hub package.json、工作流 YAML 中未发现此 CLI 的直接调用，不虚构设备或服务调用方。测试与 QA 用 `process.execPath` 启动该脚本的绝对路径、设置 cwd 为自建沙箱根，保留同一输入契约。

失败语义：命中禁模块时 exit 1，stderr 按现有格式输出 `<文件完整路径>: <模块>`，stdout 不输出 OK；无命中时 stdout 为 `OK\n`、exit 0。修正源文件后可重复执行，没有写入副作用。缺少 apps/staff-hub 时保持 stderr `apps/staff-hub not found`、exit 1。

输入对抗面：待扫描文件只读不执行，语法错误不新增解析错误；文本仍按既有字符串规则判断。空文件正常通过；大文件继续完整读取，不新增大小限制；同文件重复命中同模块仍只报该文件/模块一次，多个模块分别报告。只读稳定文件树下重复或并发进程互不共享状态。扫描时外部修改文件、权限不足等文件系统异常维持现有 Node 非零退出，不新增重试或容错。

验证：真实 spawn CLI，分别单独造 sample.mjs 中的 `import client from 'openai';`、sample.cjs 中的 `const client = require('anthropic');`，断言正常启动、exit 1、stderr 同时含目标文件路径与目标模块、无 OK。永久测试另覆盖新增两种扩展名 × 三个禁模块 × 四种既有写法，每个组合独立建目录运行，避免一个文件命中掩盖另一个漏扫。命令见 S-4，黑盒验收见 Q-1、Q-5。

### S-2
对应：I-2。

修改文件：`.github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`；实现只复用 S-1 的 CLI 改动。

对 js、ts、tsx、jsx 各扩展名独立验证既有禁模块仍阻断；测试矩阵覆盖三个禁模块及现有四种字符串写法。对全部六种扩展名分别写允许模块 `node:path`、`node:fs` 的 import/require 文本，验证 exit 0、stdout 精确为 OK 加换行、stderr 为空。扫描不加载这些模块，也不执行待扫描文件。

失败语义与真实调用方 shape 同 S-1。空目录、空文件仍是合法的无命中输入；不把注释、动态 import、转义、空白变体等既有字符串扫描局限改成新需求。

验证：S-4 指定命令运行永久测试；Q-2 对每种旧扩展名单独检验阻断，再对六种扩展名检查允许输入；Q-4 检查空输入与目录缺失两个既有边界。

### S-3
对应：I-3。

修改文件：`.github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`；`scripts/check-staff-hub-llm-imports.mjs` 的目录排除逻辑保持原样。

继续在任意遍历层级跳过名字精确为 node_modules、dist 的目录。测试在根层和嵌套层的这两类目录分别放禁模块 .mjs/.cjs；仅存在被排除命中时 OK/exit 0，随后在普通 src 目录放同样文件必须 exit 1，只报告普通目录的命中。避免用“全部目录不扫描”伪装跳过成功。

所有测试仅用 Node 内置模块、自造文件树，`mkdtemp` 前缀含任务短 ID 088c3431，加随机后缀；每个用例独享目录，结束清理自己创建的目录。不依赖真实 apps/staff-hub 数据、不发请求、不安装禁模块包。真实调用方 shape、失败语义及输入对抗面同 S-1。

验证：S-4 的永久测试和 Q-3 均从真实子进程出口观察目录跳过效果，断言诊断不含排除目录的路径。

### S-4
对应：I-4，同时支撑 I-1、I-2、I-3。

新增文件：`.github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs`。实现修改仅 S-1 指定的 CLI。不得顺带修改工作流 YAML、package.json、test-registry.yaml、版本号或产品文件。

永久测试用 `node:test`、`node:assert/strict`、文件系统和子进程内置模块；从 `import.meta.url` 相对定位仓库中的 `../../../../scripts/check-staff-hub-llm-imports.mjs`，转成绝对路径后 spawn，cwd 指向每例沙箱。必须断言子进程 error 不存在、signal 为空和明确 status；启动失败、超时、无测试收集均不能算作预期红态。所有行为断言检查子进程输出，不复制扫描算法替代真实 CLI。

build 的第一项先写永久测试，保持 CLI 未修，运行：
```sh
node --test .github/workflows/scripts/__tests__/check-staff-hub-llm-imports.test.mjs
```
保留真实 exit code、失败用例名、断言详情、解释器路径/版本、CLI SHA256 与时间。红态必须来自 mjs/cjs 本应 exit 1 却实际 exit 0 的断言失败，同时旧扩展名及允许输入用例可运行通过；然后实施 S-1，运行同一命令取得全部通过、exit 0、skipped/cancelled 均为 0。不得先修实现再伪造“先红”。后续独立 verify 从固定基线源码与相同永久测试复验红绿，按 Q-6 的隔离复制方法，绝不覆盖当前实现。

CI 真实调用方 shape 与出处：`.github/workflows/ci-l3-code.yml` 的 `openclaw-scripts-test`，ubuntu-latest、Node 22，从检出根目录执行：
```sh
node --test scripts/openclaw/**/*.test.js services/phone-adb-controller/__tests__/*.test.mjs .github/workflows/scripts/__tests__/*.test.mjs
```
新增文件直接匹配第三个 glob；该 job 无变更路径过滤。只静态核对现有调用与测试路径，不为本地验收运行其余涉及设备的套件。`.github/workflows/ci-l2-consistency.yml` 的 orphan-test-check 不匹配 .test.mjs，故无需登记。单独 Node 测试非 apps/*/src TypeScript，不触发同名 TS 配对改动。

验证：上面的定向 Node 命令提供永久测试红绿证据；`rg -n 'node --test|openclaw-scripts-test' .github/workflows/ci-l3-code.yml` 核对实际 CI 命令，核对新增文件是该 glob 的直接子文件。流程证据只写编排者指定回执位置或本次独享临时目录，不增加实现范围。

规格阶段无 shell，不声称已运行尚未创建的测试。合同预跑事实引用 01-intent.md：Node v26.8.2，解释器 /opt/homebrew/Cellar/node/26.8.2/bin/node；旧 CLI SHA256 为 ba535372fd4a906bd059387b8366341a3cfb65a6f60dfe7e400c3985f5f3f555；真实 CLI 子进程 mjs 禁模块 exit 0、cjs 禁模块 exit 0、js 禁模块 exit 1、允许模块 exit 0；前轮永久测试未修时 83 项 55 过 28 失败/exit 1，修后 83 全过/exit 0，无 skip/cancel。这些仅证明前轮命令可启动与缺陷有效，不是本次测试结果；原始证据由编排者从父任务 C7、387cb817 回执及持久 c7-z0-build-evidence 复核。本次新增测试不绑定前轮测试总数。

pre-PR 的通过条件仅为本地行为、真实红绿与 CI 收集静态核验；远端 PR、required CI 全绿、local QA、独立 ToAPIs judge 由 runner 后续检查，全部满足后停 awaiting_human，禁止合并。本规格不以本地 PASS 代替最终交付。

## QA 场景

执行地点为本 PR worktree。本节直接运行 CLI 黑盒，不以 node:test 总结替代 QA。每个场景都重新使用 Node 内置 fs.mkdtempSync(os.tmpdir() 下的 `cw-088c3431-qa-场景号-` 前缀) 造目录；fixture 仅为源码文本，无真实凭据。用 fs.mkdirSync 的 recursive 选项建父目录、fs.writeFileSync 写下面指定内容，随后 spawnSync(process.execPath, [CLI绝对路径], {cwd: 本例目录, encoding: 'utf8', timeout: 10000})，记录 status、signal、error、stdout、stderr。10 秒只作为 QA 防挂保护，超时或启动错误判 QA 失败，不能当作守卫正常拒绝。目录由场景自身 finally 清理。无网络、服务地址或预览环境依赖。

### Q-1
对应: I-1
前提: 独立创建两个临时根，各建立 apps/staff-hub/src；第一个只写 sample.mjs 内容 `import client from 'openai';`，第二个只写 sample.cjs 内容 `const client = require('anthropic');`。
操作: 在两个根分别按上述 shape 启动 PR CLI；再为 mjs/cjs、三个禁模块、单/双引号 import-from/require 的每个组合分别自建单文件目录运行，保留每次原始输出。
期望: 每次 status 为 1，无 signal/error；stderr 包含本例文件完整路径与对应模块，stdout 无 OK。每个组合独立阻断，不能仅观察两例合并执行的一次失败。

### Q-2
对应: I-2
前提: 为 js、ts、tsx、jsx 各建独立临时根和 apps/staff-hub；每次仅写 sample.扩展名，内容 `import client from 'openai';`。
操作: 分别运行 CLI，观察失败后，将该文件覆盖为 `import path from 'node:path';` 再运行；另建临时根，写齐六种扩展名，内容均为 `const fs = require('node:fs');`，运行 CLI。
期望: 四种旧扩展名原始输入都 exit 1 且报文件/openai；各例覆盖后及六扩展名允许输入 exit 0、stdout 精确为 OK 加换行、stderr 为空。未执行源码文本，无依赖安装或网络请求。

### Q-3
对应: I-3
前提: 自建 apps/staff-hub 的 node_modules、dist、src/node_modules、src/dist 四个目录，每个目录同时放 bad.mjs（`import x from 'openai';`）与 bad.cjs（`require('anthropic');`）；普通 src/allowed.js 写 `export const ok = 1;`。
操作: 先运行 CLI；随后仅在 src 新增 visible.mjs 写 `import x from 'openai';` 和 visible.cjs 写 `require('anthropic');`，再运行。
期望: 第一次 exit 0、OK；第二次 exit 1，stderr 同时报两个 visible 文件及模块，且完全不含四个排除目录下 bad 文件的路径。扫描确实进入普通目录，排除目录仍跳过。

### Q-4
对应: I-2,I-3
前提: 自建空临时根，不建 apps/staff-hub。
操作: 运行 CLI；随后在同根新建空 apps/staff-hub 再运行；最后写空的 empty.mjs 和 empty.cjs，再运行。
期望: 首次 exit 1、stderr 为 apps/staff-hub not found 加换行；第二、三次 exit 0、stdout 为 OK 加换行、stderr 为空。缺失根不是可误报通过的空输入，空目录和空文件不误报。

### Q-5
对应: I-1,I-2,I-3
前提: 自建 apps/staff-hub/src，写 repeat.mjs，其内容为两行相同的 `import x from 'openai';`；long.cjs 为一 MiB 空格后追加 `require('anthropic');`。这些只是扫描文本，不执行。
操作: 不重置目录，连续运行 CLI 两次，再并发启动两个独立 Node CLI 子进程并分别捕获结果；之后覆盖 repeat.mjs 与 long.cjs 为允许模块文本，再运行。
期望: 前四次均 exit 1，各 stderr 中 repeat.mjs/openai 仅一条、long.cjs/anthropic 仅一条，长文本末尾不漏扫；不比较不同文件诊断顺序。修正后的运行 exit 0、OK，证明重跑无遗留状态。文件内容除 QA 主动覆盖外未改变。

### Q-6
对应: I-4,I-1,I-2,I-3
前提: QA 自建独享临时目录。用本机 Git 已存在的基线 main 对象，先 `git rev-parse --verify 'main^{commit}'` 确认并固定基线 SHA；若 runner 的本次起点为 origin/main，则验证 `origin/main^{commit}` 并固定该起点。用 `git archive <固定SHA>` 在临时目录解出独立基线副本，不 fetch、不切换/覆盖 PR worktree。确认该副本 CLI 是仅扫描四种扩展名的改动前源码，记录其 SHA256；若本机缺基线对象或 main 已含修复，交给 runner 提供本次真实起点对象，不能手工删 mjs/cjs 冒充基线。分别为基线与 PR 版本新建 Q-1、Q-2、Q-3 的 fixture。
操作: 使用基线 CLI 与 PR CLI 的绝对路径，在自建 fixture 根各真实运行 Q-1、Q-2、Q-3。检查 build 回执中的新测试先红后绿时序、CLI SHA256、失败断言与解释器信息；读取 PR 中新增 .test.mjs 和 ci-l3-code.yml，确认永久测试文件匹配上述实际 CI glob。独立 verify 另可将同一永久测试按相同相对路径复制进基线临时副本，运行 S-4 命令复验红态，再在 PR 版本运行同一命令复验绿态；这一项是永久测试的补充核验，不能替代前面的直接 CLI 操作。
期望: 基线对单独 mjs/cjs 禁模块返回 0/OK，PR 返回 1 且有文件/模块诊断；旧 js/ts/tsx/jsx 阻断、允许模块通过、目录排除行为两版一致。永久测试真实先红后绿，红态是期望 1 实得 0 的断言，绿态无 skip/cancel；文件被现有 CI glob 收集。本地结果不包含尚不存在的远端 PR/CI 成功声明。

## 铁律对照

- INV-c906dd6c：S-4、Q-6 覆盖；明确引用已有真实预跑的命令退出语义，本次 build 第一项重新跑永久测试红绿，不宣称规格阶段实跑。
- INV-f200769d：S-4、Q-6 覆盖；列出预跑解释器与真实退出码，原始回执由编排者复核，新增测试另留本次启动证据。
- INV-8d92f7b1：S-4、Q-6 覆盖；前轮失败状态不复用，本次从固定真实基线独立验证。
- INV-3b9804e6：S-3、Q-1、Q-6 覆盖；所有 fixture 和基线副本用含任务 ID 的随机独享临时目录。
- INV-26a1d06e：S-4、Q-6 覆盖；基线对象使用 rev-parse --verify 加 ^{commit} 确认。
- INV-a0bac43b：S-4、Q-1、Q-6 覆盖；验证真相明确为本机真实 CLI 进程退出码、诊断与源码身份，无页面证据要求。
- INV-9216d107：S-4、Q-6 覆盖；按本仓 local 能力验收，不要求预览服务或设备证据。
- INV-6d11717d：S-4、Q-6 覆盖；检查实际执行与断言，不用 CI 颜色替代，启动失败和未收集不得算红绿。
- INV-09fb5c69：S-1、S-2、S-3、S-4、Q-1、Q-2、Q-3、Q-6 覆盖；四个 I 条目均有独立行为与黑盒验收，不以 CI 通过代替 QA。
- INV-e9c7752f：S-4、Q-1 覆盖；子进程返回 status/error/signal 均显式检查，不仅依赖抛异常。
- INV-1100cb8f：S-4、Q-6 覆盖；复用现有 CI glob，不改共享工作流或基线清单。
- INV-c674ab49：S-4、Q-6 覆盖；直接检查真实 CI YAML 的测试接线，行为仍由真实 CLI 验证。
- INV-a39272f7：S-4、Q-6 覆盖；回执优先放解释器启动、源码身份、红绿退出码及关键失败断言。
- INV-5e125909：S-3、S-4、Q-6 覆盖；解释器取 process.execPath、路径相对 import.meta.url、临时根动态创建，基线对象显式验证。
- INV-3c30394c：S-4、Q-6 覆盖；本地真实 CLI 为本任务目标；远端 CI 与独立裁判尚待后续真实验证，不能提前宣告最终完成。
- INV-564802ee：S-3、Q-1 覆盖；无密钥依赖，只用合成源码，不把 secrets 放入测试或日志。
- INV-459b6ff9：S-3、Q-1 覆盖；诊断与 fixture 仅包含合成路径和模块名，不使用客户数据。
- INV-e8230eb5：S-4、Q-6 覆盖；交付后停 awaiting_human，不自行合并。
- INV-91ee7d53：不适用：本次用户明确禁止合并，不能据旧高频合并建议开启 auto-merge。
- INV-45cd3ec2：不适用：只读 CLI 测试不生成写入 smoke、不触发生产授权 guard。
- INV-ff177feb：不适用：该旧规则已被 INV-45cd3ec2 撤销，本改动也无生产 smoke。
- INV-55b8eb46：不适用：CLI 只扫描本地源码，无租户模型或租户数据。
- INV-68976b17：不适用：无数据库查询、写入或跨租户链路。
- INV-50954d28：不适用：没有 HTTP 端点，CLI 不新增鉴权面。
- INV-76cb816c：不适用：保留 CLI 内唯一 banned 列表，不增加跨模块生产枚举副本。
- INV-be038f9e：不适用：没有环境变量或部署配置改动。
- INV-1129ee0d：不适用：改动不触及权限、资金、外部发布或生产数据。
- INV-d9e4f4c1：不适用：不使用双引号内嵌 JavaScript 模板表达式的 node -e 命令。
- INV-02d8e749：不适用：仅修独立 CLI，不重写 coding 编排链及其阶段能力。
- INV-dc18d43d：不适用：生命周期与记账由现有 runner 负责，本规格不改编排或账本。
- INV-91e9abe3：不适用：被测脚本不调用模型或启动无头编码会话，文件中的禁模块只是扫描文本。
- INV-067867c8：不适用：不调用 cecelia-bridge 或任何模型桥接通道。
- INV-751f73be：不适用：不新增无人值守模型启动或保活。
- INV-ca6bf8e7：不适用：仅本机 Node 子进程，不部署模型引擎到其它机器。
- INV-06950012：不适用：文件留在 ZenithJoy，未增加设备 runner 或跨仓迁移。

## 未覆盖真实链路

- 远端 GitHub PR required CI 与独立 ToAPIs 裁判：pre-PR 本地 QA 尚无对应远端产物/裁判回执，只验真实 CLI、永久测试红绿及 CI glob 静态接线；由 runner 后续真实执行，最终停 awaiting_human，不合并。
- 历史预跑原始回执：规格工具只能读工作树，01-intent.md 引用的父任务 C7、387cb817 和持久 c7-z0-build-evidence 未在本阶段独立读取；需编排者复核，不以历史结果替代本次 build/verify。
- 既有扫描语法局限：动态 import、裸副作用 import、空白/转义变体、注释误报及符号链接语义不属于本次扩展名修复，QA 不宣称全面识别 JavaScript 依赖；建议另立任务。
- 直接部署/构建是否调用此 CLI：已读 package.json 与工作流 YAML 未发现直接调用，本次只确保新增永久测试进入既有 CI glob，不新增调用链；如需强制部署入口执行，建议另立任务。
- 第三方 API 链路无：本 CLI 只读文本，模块名不代表调用对应 SDK；无需 key，不访问第三方、生产数据库、页面或设备。

