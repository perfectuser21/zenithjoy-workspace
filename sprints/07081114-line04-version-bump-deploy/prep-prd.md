# Bug PrepPRD：line04 微信客服模块三个已合并 P0/P2 修复从未 bump 版本号，导致从未分发到客户机

## 症状
2026-07-08 real-machine 验证 #1160/#1163 时发现：`services/agent/build-modules/line04/manifest.json` 和 `services/agent/modules/line04/manifest.json` 的 version 字段自 #1162（v1.0.111）后就没再变过，但 #1160（图片消息丢失，P0）、#1163（UIA自愈重启漏杀WeChatAppEx.exe，P0）、#1165（真机气泡gate找目标会话，P2）三个 PR 全部合并进 main，代码里已经有修复，却因为没有版本号变化，客户端 OTA 更新机制永远不会拉取新代码。rog 真机现在跑的还是 v1.0.110，三个已"合并"的 bug 修复实际都不在生产上生效。

## 根因假设
`services/agent/build-modules/line04/manifest.json` 是每次 fix PR 手动 bump 的（历史上每个功能性修复 PR 都在同一提交里手动改这个文件），#1160/#1163/#1165 三个 PR 都遗漏了这一步——没有 CI 闸门强制"改了 wechat-rpa 源码就必须 bump manifest 版本号"，纯靠人/AI 自觉，漏了没人发现。

## 关联上下文
- 相关 Journey：客户私域 AI 接管（Line04），journey_id bfeed805-deed-46c3-8624-87f0028101d4
- 相关 Issue：4024c90b（#1160）/ 05630ae5（#1163）/ 69c634b7（#1165）
- 本次新发现 Issue：99741ff9（窗口未最大化导致完全检测不到消息，P0）

## 修法
1. `services/agent/build-modules/line04/manifest.json` version 从 1.0.111 bump 到 1.0.112
2. `services/agent/modules/line04/manifest.json` version 同步 bump 到 1.0.112
3. 确认 `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` 与根目录 `services/agent/wechat-rpa/listen_chat.py` 内容一致（#1163/#1165 是否同步到 build-modules 副本需要核实，历史上 #1162 是两处都改的）
4. 同步 smoke 脚本版本号（参照 #1162 的做法）

## Regression Test 计划
新增一个 CI 检查脚本/测试：diff 检测到 `services/agent/wechat-rpa/**` 或 `services/agent/build-modules/line04/wechat-rpa/**` 有实质代码改动时，`services/agent/build-modules/line04/manifest.json` 的 version 字段必须相应变化，否则 CI 红（同 `lint-feature-has-smoke` 性质的机械闸门）。

> ⚠️ 环境接缝：这是"代码合并 vs 实际分发"的接缝，纯 CI test 测不出真实分发是否生效，还需要一个部署后冒烟/验证步骤（如 harness-evaluator 或独立巡检核对 rog 真机版本号是否追上 main 的 manifest 版本号）。

## 验收标准
- [ ] failing test 先 commit（能证明"改了 rpa 源码但没 bump 版本"会被 CI 拦下）
- [ ] manifest 版本号 bump 到 1.0.112，build-modules 副本与 modules 副本同步
- [ ] CI 全绿
- [ ] rog 真机 OTA 后版本号确认变为 1.0.112（真机验证，不只是 CI）
