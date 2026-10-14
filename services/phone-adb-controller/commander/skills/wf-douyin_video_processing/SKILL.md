---
name: wf-douyin_video_processing
version: 0.1.0
description: "抖音视频处理 wf_run 陪跑说明：显式加载本次冻结业务Skill，保持原合同与安全交接边界。"
---

# 抖音视频处理陪跑

此薄 wrapper 对应 `product-map/contracts/douyin_video_processing.yaml` 的 `commander_skill`；业务真身只有 `services/phone-adb-controller/skills/douyin-leadgen-102/SKILL.md`，不在此复制动作。

当前 `wf_run` 须由 Agent 显式加载本 wrapper 和业务 Skill，自动调用未接好。此字段入冻结合同不表示 runner 已调用 Skill，也不把本流程改成通用 Commander 的 `codex_agent` 或 commander-v2 执行协议。

从本次正式 `run-definition.json` 的对应 `activities[].implementations` 选择已核 `kind: skill`、name/version/source/digest，按真实 `execution_path` 读取业务 Skill。其冻结部署路径为 `<WFR_RUN_DIR>/runtime/skills/douyin-leadgen-102/SKILL.md`；同时读取该冻结目录 `references/runtime-calls.json` 和 `references/reuse-map.json`。仓路径用于来源核对，最新部署副本或本机Codex链接不能替代本次冻结字节。缺绑定、路径、版本或SHA读回立即阻断。

执行前确认 workflow_key 为 `douyin_video_processing`，实际公司、line、profile、serial、run_id、attempt、source_run（适用时）、执行权、截止时间及锁/租约均与冻结事实一致。保持原 Activity Commander、定义ACK、原件及PG独立读回；不改现场代码、不换账号、不扩大预算或输入范围。

`mode=workflow` 仅在当前业务 Skill 的正式完整CLI满足本轮范围时执行该流程；`mode=activity` 只处理指定冻结 Activity。现无合法单 Activity resume 公共入口；无法安全移交当前执行权或工具缺失时保留原失败及恢复条件并报告 BLOCKED，不能重跑整流程冒单步接手、使用 `leadgen-activity.sh` 冒 resume、直调裸queue/RPC函数、并发接管活动run或回退旧流程。旧Skill参考仅加载 reuse-map 明确适用动作，不把 reference_only 当可执行fallback。

只处理102资格与评论采集。来源必须是本次冻结并合法验证的101 source_run；保持实际VID、音频、评论者身份、正文和返回面板守卫。首轮5评论与后续分档按授权及业务Skill支持情况执行，未实施分档不能冒称自动支持。

交接只报告实际运行、逐活动/Step核验、清理及业务读回；代码退出0、合同可加载或 planned登记均不等于业务PASS。未知外部副作用先取合法读回，不能补造证据或重放动作。
