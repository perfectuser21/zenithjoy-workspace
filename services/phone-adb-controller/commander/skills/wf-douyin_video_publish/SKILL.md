---
name: wf-douyin_video_publish
version: 0.1.0
description: "work-commander 陪跑 skill：抖音·视频发布（安卓真机，私密）workflow 的专属陪跑规矩。由 workflow-commander 第〇节按合同 commander_skill 字段自加载，不靠猜名字。第一阶段只记已知正常态与处置，随运行攒厚。"
---

# 陪跑 skill · 抖音视频发布（wf-douyin_video_publish 0.1.0）

> 真身：zenithjoy-workspace `services/phone-adb-controller/commander/skills/wf-douyin_video_publish/SKILL.md`，deploy.sh 同步到 work-commander 工作区。
> 合同：`product-map/contracts/douyin_video_publish.yaml`（`commander_skill: {name: wf-douyin_video_publish, version: 0.1.0}`）。
> 熟化四态（决策 26df670a）：本 skill 从运行中攒出（变厚）→ 重复的写成代码（变薄）。第一阶段 0.1.0 = 最薄：只有正常态表与已知坑。

## 形态

codex_agent：外壳准备（wf-agent-run 查手机/领控制器锁/查账号）→ 业务块（skill-factory agent 在 Codex 运行时跑业务 skill `android-douyin-private-video` 当前候选版）→ 外壳收尾（关抖音/放锁/回读 free/汇总 delivery.json）。你只照调度单起跑、陪跑、汇报；**不判成败**（决策 7465d08f），成败由活动读回 + Brain 裁判定。

## 正常态（陪跑时对照，读 wf-status.sh mmv <TAG>）

| 阶段 | 正常 | 预算 |
|---|---|---|
| 外壳准备 | 日志出现 `preflight ok`，锁 owner=本 run_id | ≤ 3 分钟 |
| 业务块 | `agent running`，每 15 秒一条心跳行；controller 锁每 10 分钟续租 | ≤ 45 分钟 |
| 外壳收尾 | `cleanup lock_status=free`，随后 `WF_RUN_RESULT` 与 `WF_RUN_FINISHED` | ≤ 3 分钟 |

## 已知情形与处置（三档权限内）

| 情形 | 处置 |
|---|---|
| 外壳准备 `lock_busy`（手机被别的 run 占） | 不抢锁；如实汇报 blocked，等下一轮 |
| 外壳准备 `account_mismatch` | 不切号（切号属 Bark 请示档）；汇报 blocked |
| 业务块报「继续编辑作品吗？」旧稿弹层且正文无放弃授权 | 正常安全停止，汇报 blocked，原因原样转述 |
| 业务块超时 | 外壳会杀会话并收尾；汇报 failed，附 agent.log 尾 |
| 发布后取证超时（业务 skill 退出码 3） | 已点过发表，**不得重跑**；汇报并请 Brain 裁判按读回判 |

## 汇报

COMMANDER_RESULT 里 `commander_skill` 写 `{"name":"wf-douyin_video_publish","version":"0.1.0"}`；evidence 抄 delivery.json 的 `final_evidence` 与各活动 `evidence_files`。新判例写进 FINDINGS，攒够再升本 skill 版本（改合同 commander_skill.version 同 PR）。
