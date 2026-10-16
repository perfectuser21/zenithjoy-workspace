---
name: wf-douyin_lead_outreach
version: 0.2.3
description: "抖音线索触达 wf_run 陪跑说明：显式加载本次冻结业务Skill，保持原合同与安全交接边界。"
---

# 抖音线索触达陪跑

此薄 wrapper 对应 `product-map/contracts/douyin_lead_outreach.yaml` 的 `commander_skill`；业务真身只有 `services/phone-adb-controller/skills/douyin-leadgen-104/SKILL.md`，不在此复制动作。

当前 `wf_run` 须由 Agent 显式加载本 wrapper 和业务 Skill，自动调用未接好。此字段入冻结合同不表示 runner 已调用 Skill，也不把本流程改成通用 Commander 的 `codex_agent` 或 commander-v2 执行协议。

先从本run已验证的冻结部署清单读取工作流业务Skill `runtime/skills/douyin-leadgen-104/SKILL.md` 及其 `references/activity-methods.json`、`runtime-calls.json`、`reuse-map.json`，核对本run源码和每文件SHA。再从 `run-definition.json` 对应Activity的 `implementations` 选择确切 `kind: skill`、name/version/source/digest，并按真实 `execution_path` 读取独立Activity Skill及其支持文件。Workflow清单必须与各Activity冻结绑定完全一致；不能再把整流程业务Skill路径当成每个Activity方法。最新部署副本或本机Codex链接不能代替本run冻结字节，缺绑定或原件即阻断。

执行前确认 workflow_key 为 `douyin_lead_outreach`，实际公司、line、profile、serial、run_id、attempt、source_run（适用时）、执行权、截止时间及锁/租约均与冻结事实一致。保持原 Activity Commander、定义ACK、原件及PG独立读回；不改现场代码、不换账号、不扩大预算或输入范围。

`mode=workflow` 仅在当前业务 Skill 的正式完整CLI满足本轮范围时执行该流程；`mode=activity` 只处理指定冻结 Activity。仅接受原run已生成的leadgen-activity-v1请求及其私有broker工具；无法安全移交当前执行权或工具缺失时保留原失败及恢复条件并报告 BLOCKED，不能重跑整流程冒单步接手、使用 `leadgen-activity.sh` 冒 resume、直调裸queue/RPC函数、并发接管活动run或回退旧流程。旧Skill参考仅加载 reuse-map 明确适用动作，不把 reference_only 当可执行fallback。

只处理104 canonical ready队列的已批准触达与写回。保持原prepared、一次发送、全池去重、账号及原生目标身份、批准正文、风险和ratecaps；暂停未解除不发送。已发送或结果未知先按原状态机读回，不重复POST、不释放prepared重发，不用裸private-message-send或旧outreach-tick代替正式入口。

交接只报告实际运行、逐活动/Step核验、清理及业务读回；代码退出0、合同可加载或 planned登记均不等于业务PASS。未知外部副作用先取合法读回，不能补造证据或重放动作。

## 方法升级

本流程依赖的Activity方法版本由业务Skill的 `references/activity-methods.json` 精确登记。方法变化要同步本陪跑Skill版本与合同 `commander_skill.version`；Commander只使用本run冻结组合。代码内部兼容评估、Skill实机验收和自动handoff能力分别记证据，不从文件存在推定已能接手。
