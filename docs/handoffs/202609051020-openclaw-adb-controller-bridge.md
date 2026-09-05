# Handoff：OpenClaw adb_controller → phonectl.sh 信号桥适配层（PR#1777）

> task_id=unknown（路径B小改动，未走 Brain task 注册）

## 结论

**PASS**。PR #1777 已合并（squash merge，`perfectuser21/zenithjoy-workspace`），分支 `cp-0905082235-openclaw-adb-controller-bridge`。

## 归位

`customer_app/line02/keyword_acquisition` · **置换**（不新增格子坐标）· GP-Anchor: `line02/keyword_acquisition keep-green`。

## 背景

09-04 sprint 完成 OpenClaw 信号桥三件套（件1 agent-android 统一指令处理器 PR#1762 / 件2 中台设备指令桥 PR#1765 / 件3 phonectl.sh CLI PR#1771）后，用户提出真正诉求：不满足于手动模拟一次获客 demo，而是要让 OpenClaw 侧已经在生产给"悦升"/"金诺"两个内部租户天天跑的智能获客系统（Work Commander + AI 视觉 worker agent + `douyin-phone-runtime` skill），真正通过信号桥操作手机——替代现在"SSH 到 xian-m1 本地跑 adb"的老路径（对真实客户机完全不可行）。

经 `/capability`（golden-path）判定 + 三镜头 GAN 对抗：最初拍板方向是"平行新路 `keyword_acquisition_openclaw`"，但对抗发现三问法不过、命中反模式（同一终点只是执行引擎不同），主理人接受纠正改判为"对既有 GP 的置换"，范围收窄为仅 Step②③（找视频、发现 Lead），私信（Step④）不动、服务对象不变（仍是内部测试租户，不涉及真实付费客户）。

## 完成

- 新增 `scripts/openclaw/adb-controller-bridge.sh`：实现 `preflight` / `lock-acquire` / `lock-release` / `lock-status` / `open-app` / `snapshot` / `snapshot-evidence` / `tap-evidence` / `swipe-evidence` / `back-evidence` 十个命令，`current-video-link`/`record-*`/`ui-evidence` 显式返回 `UNSUPPORTED`（exit 3）
- 新增 `scripts/openclaw/profiles.json`（`phone_profile → {agent_id, tenant_id}` 静态映射，登记 `realmachine-smoke`）
- 新增 `scripts/openclaw/__tests__/adb-controller-bridge.test.js`（40 个测试，`node --test` + mock HTTP server 风格，已登记进 `test-registry.yaml`）
- 通过 subagent-driven-development 走完 5 个 Task，每个 Task 后经 spec compliance + code quality 两阶段审查，共发现并修复：
  - 1 个 Critical 命令注入漏洞（`wait_ms` 未校验直接拼进 awk 源码，可 `system()` 执行任意命令）——修复前后有对照实证（修复前 payload 真实创建了 marker 文件并留下孤儿 sleep 进程）
  - 3 个 Critical 数据完整性 bug（base64 解码失败静默报成功、macOS/BSD base64 静默截断、非原子写入销毁已有证据文件）
  - **真机验证发现的真实 bug**：设备端截图实际是 JPEG（`ScreenCaptureReal.kt:181`），最初实现误假设 PNG，导致真机上 100% `CAPTURE_FAILED`，已修正
  - 本地锁的损坏防护、原子写入、重入续期 TTL
- 真机验证（staging `realmachine-smoke`，agentId `e017953c-bc65-47e0-913e-a2ed5eb54993`，HONOR MAA-AN00）：`preflight` ✅、`snapshot-evidence` ✅（落盘 JPEG 内容与手机实际画面一致）、`tap-evidence` 动作执行 ✅（截图撞上已知缺口，见下）

## 未完成 / 明确范围外

1. `call_state`（通话状态）无法真实检测——phonectl 原子指令集没有这个能力，固定返回 `unknown`
2. `current-video-link`/`record-*`（全文判定录制）不实现——命令桥 35s 同步协议跟录制这种跨调用长任务协议形状冲突，`keyword_acquisition` 也用不到
3. `phonectl.sh screenshot` 底层间歇性失败（`CAPTURE_FAILED`）——真机验证观察到"tap 后立即截图"比单独截图更容易触发，根因疑似跟上墙推流 `FramePushLoop` 抢占 `MediaProjection` 有关，属于 agent-android 底层技术债，不在这次 bridge 脚本范围
4. `profiles.json` 手动维护，不做自动发现
5. 本地锁机制是 check-then-act 非原子操作，存在低概率 TOCTOU 竞态窗口——当前场景（内部测试租户、近似串行调用）影响可忽略

## 下一步

1. **运维手动动作**（不在本 PR 范围）：在 HK OpenClaw 网关上把 `realmachine-smoke` 这个 profile 的 `adb_controller` 路径改指向这个新脚本，才能真正让 OpenClaw 的 `social-leadgen-workflow` 通过信号桥而非 adb 驱动手机
2. 如果要验证"正儿八经的 OpenClaw 智能获客系统"整条链路，需要先解决 Task 5 记录的已知缺口3（phonectl.sh screenshot 稳定性），否则 Step②/③ 涉及的截图操作会有真实失败率
3. `com.zenithjoy.agent.e2e` 同族变体包仍装在测试机上，之前会话已提示需要卸载，本次未处理

## 数据源

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1777
- 设计文档: `docs/superpowers/specs/2026-09-05-openclaw-adb-controller-bridge-design.md`
- 实现计划: `docs/superpowers/plans/2026-09-05-openclaw-adb-controller-bridge.md`
- Decision: `8dd822c4-1630-414e-ba22-c1982c1f2e9a`（Brain strategic-decisions，category=small-change）

## Artifacts

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1777
- Branch: `cp-0905082235-openclaw-adb-controller-bridge`
