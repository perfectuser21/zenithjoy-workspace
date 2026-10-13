---
name: wf-douyin_video_publish
version: 0.1.2
description: "通用 Commander 的抖音私密视频合同说明：固定输入、手机资源、活动事实、停止边界与独立核验。"
---

# 抖音私密视频 · Commander 合同说明

真身：`services/phone-adb-controller/commander/skills/wf-douyin_video_publish/SKILL.md`。合同：`product-map/contracts/douyin_video_publish.yaml`，commander_skill 版本 0.1.2；部署同步到 work-commander 工作区。

正式入口使用 `$workflow-commander` 的 commander-v2 全链路。接收本次完整原始信封，始终以冻结 contract、activity_bindings、definition.expected_path 和两个绝对截止时间为准。运行文件与工具在 MMV，通过 `gateway_exec` 执行；模型本机目录不是运行目录。

业务 child 为 `skill-factory`，加载 `multi-platform-publish`，按抖音视频分支及已登记手机手册操作。设备为冻结 resources 指定的 xian-m4 / xiaolongxia / ANGYVB4311010223 / Ai办公室；不切账号、不换设备。

| 合同项 | 要求 |
|---|---|
| 输入 | title、body、media_path、media_sha256、allow_discard_existing_draft 完整保留；authorized=true、privacy=private、content_type=video |
| 预算 | 总执行 2400 秒、收尾 300 秒；以信封 deadline_at / cleanup_deadline_at 剩余时间为准，恢复不重置 |
| 尝试 | max_attempts=1、retry_safe=false；发布结果未知先读回，不重复发表 |
| preflight | 外壳真实账号及精确owner读回，执行包/run/evidence根身份前后核对，原始controller回执归档 |
| prepare / publish / verify | child逐项记录实际活动及step，核对源SHA、原标题正文和私密权限；不能代补外壳事实 |
| cleanup | 外壳关应用、回原桌面、精确释放与free读回，原件保留；cleanup_pending只补清理，不重复业务 |
| 交付 | publication、privacy、readback、media_sha256、evidence符合冻结output_schema；work_id取得才保存，不伪造 |
| 完成 | 读 `wf-status.sh <run_id>` 的机器JSON，awaiting_verify只表示已交付；独立核验通过才完成目标 |

旧编辑弹层只在输入 allow_discard_existing_draft=true 时可放弃旧稿；缺授权保留明确阻塞。账号/owner/来源不符立即停止，不试图靠改现场代码继续。

源SHA原件在prepare保留，独立核验重算；Brain设备租约free在delivery后由独立核验读取，不能让执行者提前声称已释放Brain租约。已点击发表而回执/实屏未知时保留 effects=unknown，禁止重派。

旧五参数仅用于历史在途外壳兼容收尾。新工作不使用旧TAG、旧日志行或固定长预算判断状态，也不召唤其他看护角色。
