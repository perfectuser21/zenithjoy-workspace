# Bug PrepPRD：desktop-lease-broker 日志落盘修复进了 Line04 的 deprecated 死文件，真实模块从未接收到这个修复

## 症状
PR#1096 给 `services/agent/src/handlers/wechat-rpa.ts` 加了 `appendListenChatLog`（把 listen_chat.py 的 stderr 诊断日志落盘），代码合并、单测全绿、CI 全绿。但真机 xian-rog 上运行了很久也没有出现日志文件 `<配置目录>/logs/listen-chat.log`。

## 根因假设
`services/agent/src/handlers/wechat-rpa.ts` 文件头明确标注 `@deprecated`：
```
// @deprecated Sprint 06081700 — 微信 RPA 逻辑已迁移到独立 line04 模块包
//   （modules/line04-wechat-cs/，PR #686）。Core v2.0.0 不再直接 import 本文件，
```
真正被 Line04 模块编译进客户机安装包、实际运行 `startWechatListener` 的文件是**独立维护的另一份**：`services/agent/modules/line04/handlers/wechat-rpa.ts`（`build-line-module.sh` 只编译 `modules/$LINE_ID/*.ts` + `modules/$LINE_ID/handlers/*.ts`，不碰 `services/agent/src/`）。这两份文件在 sprint 06081700 模块化拆包时就已经分叉独立维护，PR#1096 改错了文件——日志落盘代码进了没人在跑的那一份。

**已交叉核实、确认没问题的部分（不需要动）**：
- PR#1085 的 Python 侧修复（`listen_chat.py` 的 `reply_in_chat_with_lease`）：`services/agent/wechat-rpa/listen_chat.py` 是全局共享 Python 源，`build-line-module.sh` 用 `rsync` 直接拷进每个模块包，不受 TS 文件分叉影响，这部分是真的会生效的。
- PR#1085 的 `registerLeaseBrokerRoutes` 接线：DesktopLeaseBroker 设计上是 core 进程级单例（整机共享一把锁），挂在 `services/agent/src/index.ts` 是正确的架构位置，不需要在模块里重复注册。

**额外发现的部署机制问题**：CI 里已有一条"line04 三个版本面一致（modules / build-modules / 中台心跳）"闸门（注释写着"防漂移守卫，修 #817 部署 gap 的根"），PR#1085 和 #1096 都没有触发这个流程去 bump line04 模块版本号——`services/agent/modules/line04/manifest.json` 和 `build-modules/line04/manifest.json` 都还停在 1.0.106（这个版本号是更早的、不相关的 PR#1073 留下的），意味着哪怕改对文件，不 bump 版本号，走完整三面同步流程，客户机也不会重新下载新模块包。

## 关联上下文
- 相关 Journey/Ability：Line04 客户私域 AI 接管 / 桌面租约仲裁层(Desktop Arbiter)（feature_id 8358dd63-c0fe-4942-a2f5-d9b5d7c9e3bb）
- 相关历史决策：无直接匹配（decisions/match 查无）
- 相关 PR：#1085（真实回复主循环接线）、#1096（日志落盘，本次要修的对象）
- 相关历史 Issue 类型：CI 注释提到 #817 是同一类"只 bump 了 build-modules 忘了 modules 源"的部署 gap，本次是反过来——两处都没 bump

## 修法
1. 把 `appendListenChatLog`（含 `child.stderr.on('data', ...)` 回调里的调用）真正加到 `services/agent/modules/line04/handlers/wechat-rpa.ts` 的 `startWechatListener`（第 188-234 行附近）里——这是真正被编译进客户机安装包的文件。
2. 模块级代码不能依赖 core 的 `config-loader.ts`（`build-line-module.sh` 只编译 `modules/line04` 下的文件，没有到 core src 的模块解析路径）——在 `modules/line04/handlers/wechat-rpa.ts` 里内联一个自包含的最小日志目录解析逻辑（复用该文件已有的"基于模块目录/客户机路径解析"约定，不引入新的跨模块依赖）。
3. bump 三面版本号，必须完全一致（CI 闸门会卡）：
   - `services/agent/modules/line04/manifest.json`
   - `services/agent/build-modules/line04/manifest.json`
   - `apps/api/src/services/walking-skeleton.service.ts` 里 `HEARTBEAT_MODULES` 对 `line04-wechat-cs` 的 `required_version`
4. 跑一遍 `services/agent/scripts/build-line-module.sh line04`，确认编译产物 `build-modules/line04/handlers/wechat-rpa.js` 真的把新代码编译进去了，和源文件不再有这处逻辑差异（提交编译产物）。

## Regression Test 计划
- 单测：在 `modules/line04/handlers/__tests__/`（或该目录已有的测试位置）加测试，验证 `startWechatListener` 的 stderr 回调真的调用了日志落盘函数（mock `fs.appendFileSync` 断言被调用），防止未来再有人改错文件却测不出来。
- CI 闸门（已存在，不用新建）：`ci-l4-runtime.yml` 的"line04 三个版本面一致"检查会在这次 PR 里自然验证 bump 是否正确、三面是否一致——这本身就是这类 bug 的机器守卫，不需要新写。

> 这个 bug 碰到的是"改错文件+没触发部署流程"这类环境/部署接缝，逻辑单测只能证明"新文件里的函数存在且被调用"，无法证明"客户机真的会收到"——后者要靠已有的三面版本一致性 CI 闸门 + 后续真机验证（记录在下方"验收标准"里，作为待办，不在本次 bug 修复范围内强制现在做）。

## 验收标准
- [ ] failing test 先 commit（commit-1）：证明 `modules/line04/handlers/wechat-rpa.ts` 的 `startWechatListener` 里现在没有日志落盘调用
- [ ] 修复代码让 test 变绿（commit-2）：加上 `appendListenChatLog`（内联版本）+ 三面版本号 bump + 重新编译 build-modules
- [ ] `ci-l4-runtime.yml` 里"build-modules/line04/wechat-rpa in sync with source"和"line04 三个版本面一致"两条已有闸门跑绿（证明本次改动真的被这两条守卫覆盖到）
- [ ] 已为本 bug 配 proven-to-fire 守卫：本地跑一次三面版本刻意改错（比如只改 modules 不改 build-modules）确认 CI 闸门真的会报红，截图/日志留证
- [ ] CI 全绿
- [ ] 待办（不阻塞本次合并，记录留给用户后续决定）：xian-rog 上的 agent 为什么落后到模块 1.0.102 而不是 main 上的 1.0.106，需要另外排查 OTA 触发链路，不在本次 bug 修复范围
