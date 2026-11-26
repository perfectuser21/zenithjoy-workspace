# 安卓获客执行模式

安卓获客按业务执行入口辨认模式。当前代码有三条可辨认的入口，是否能在某台设备上领单取决于对应的发布和账号绑定。

| 执行模式 | 谁推进业务 | 识别依据 |
| --- | --- | --- |
| 公共 Runner | Runner 按冻结合同推进 Activity。业务可由代码或 Agent 执行 | `workflow-domain/v1`，入口 `leadgen-public-domain.mjs`。冻结定义的 `execution_mode` 为 `code` 或 `agent` |
| Commander Foundation | Brain 派发固定版本任务，Foundation Worker 交给 Commander，通过 DBOS 推进 Activity 并持久化恢复 | `commander-foundation-v1`，使用 Brain `/workflow-foundation/tasks` |
| **受管 Skill 直跑** | 独立 Codex 会话按 Skill 推进业务。本机宿主校验任务、设备和账号，提供受限单步工具、资源保护和证据回执 | `codex-skill-tools/v1`，入口 `standalone-skill-runtime.mjs`。Brain 的受管领单入口为 `/workflow-foundation/standalone/claim` |

发布、实测报告和任务说明统一写「受管 Skill 直跑」。记录实际的协议、版本和 run ID，便于核验本次走了哪条入口。直接调用 `douyin-phone-adb` 或微信专用控制器的实机冒烟，记作「手机控制器直测」。

归类一条实测时，以实际领取入口、启动回执和宿主适配器为准。共用候选包可以包含多个入口，安装观测只证明文件已经部署。

历史记录中的「轻量」按上下文读：

- 「轻量 101 执行候选」的发布键为 `douyin_video_discovery_lightweight`，属于 Commander Foundation。这个 101 候选把发现动作交给受管脚本，可描述为「101 受管发现候选」。
- 「轻量 102」在独立宿主接入 PR 中指受管 Skill 直跑的 102 入口。新记录写「102 · 受管 Skill 直跑」。
- 「101 单检」仍属于 Commander Foundation。开工检查放在流程入口，各 Activity 保留完工检查。

`leadgen-foundation/sources/` 中的七个 JSON 是发布来源清单，包括 101 的两个候选和 ASR。它们用于冻结来源。发布的版本 ID、路由键、协议和历史回执沿用原标识。

## 核对入口

- 公共 Runner 和受管 Skill 直跑的适配器分支见 [public-domain-profile.mjs](../services/phone-adb-controller/public-domain-profile.mjs)，Code 与 Agent 的冻结校验见 [runtime-definition.mjs](../services/phone-adb-controller/runtime-definition.mjs)。
- 两种 101 候选的运行时可在 [受管发现来源](../services/phone-adb-controller/leadgen-foundation/sources/101-lightweight.json)与 [单检来源](../services/phone-adb-controller/leadgen-foundation/sources/101-single-check.json)读回。
- Commander Foundation 的固定派单和恢复见 [Brain #6889](https://github.com/perfectuser21/cecelia/pull/6889)。受管 Skill 直跑的独立入口及 102 回执见 [Workspace #2468](https://github.com/perfectuser21/zenithjoy-workspace/pull/2468)与 [Brain #6982](https://github.com/perfectuser21/cecelia/pull/6982)。
