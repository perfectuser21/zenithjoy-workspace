# 小改动 PrepPRD：给 OpenClaw 的 adb_controller 写一个 phonectl.sh 适配实现

## 改什么
新写一个脚本（暂命名 `scripts/openclaw/adb-controller-bridge.sh`），对外严格匹配
douyin-phone-runtime skill 要求的调用形态：`<adb_controller> --profile <phone_profile> <command> [args...]`。
先实现这次范围要用到的命令：`preflight / lock-acquire / lock-release / lock-status /
open-app / snapshot / snapshot-evidence / tap-evidence / swipe-evidence / back-evidence`。
内部改调已合并的 `scripts/openclaw/phonectl.sh`（走中台 ws0 命令桥操作手机），不再走
"SSH 到 xian-m1 本地跑 adb" 的老路。

`--profile <phone_profile>` 到 `agentId` 的映射先用一个本地配置文件（如
`scripts/openclaw/profiles.json`）手动登记，这次只登记 `realmachine-smoke` 这台测试机
（agentId e017953c-...），不做通用的自动发现。

## 为什么改
验证 OpenClaw 现有的智能获客系统（Work Commander + AI 视觉 worker agent）接上信号桥后，
在真机上到底跑成什么样——这是纯技术验证，还没到投产阶段。

## 关联上下文
- Journey/Ability：customer_app/line02/keyword_acquisition（置换动作，不新增格子坐标）
- 本次是 09-04 sprint "OpenClaw 信号桥"三件套（件1 PR#1762 / 件2 PR#1765 / 件3 phonectl.sh）
  的直接延续，GP_ANCHOR 沿用 keyword_acquisition
- 已走过 /capability 归位判定 + 三镜头 GAN 对抗，范围已明确收窄（详见对话历史）

## 关键技术决策（本次范围内，避免重新踩坑）
- **`preflight` 的 account_verified 证据**：不靠 phonectl 截图/UI树自己识别，直接查
  中台既有 API（`agent_platform_sessions` 表，即 `GET /api/agent/burner/sessions` 或
  等价查询）判断"小号是否 active"，账号验证这件事本来就有标准答案，不用 AI 猜。
- **screenshot bug 必须先绕过/查清**：`phonectl.sh screenshot` 现在会报
  `CAPTURE_FAILED/busy_or_blank_after_3_attempts`，代码里已经写明是 MediaProjection
  单例被上墙推流（FramePushLoop）抢占导致的"有意合并、不可分"设计。这次验证时手机
  不要同时开着"上墙"功能，先用这个方式规避，不改动 agent-android 代码。
- **`current-video-link` 和 `record-*`（录制/全文判定）这次不实现**——keyword_acquisition
  的 Step②③ 用不到，报 `unsupported` 即可，不阻塞主流程。
- **私信（Step④）这次完全不碰**——不新增任何私信相关命令，继续留给现有代码引擎。
- **设备锁**：OpenClaw 侧的 `lock-acquire/lock-release` 简单映射成一个本地文件锁
  （或调用中台既有的 `AutomationLease` 状态查询），不需要做复杂的跨系统分布式锁，
  这次只有一台测试机、一个执行体在用，够用就行。

## 影响范围
只新增文件，不改动现有 API/Agent 代码，不影响生产客户。唯一需要手动配合的运维动作：
在 OpenClaw 网关（hk-vps）上把 `realmachine-smoke` 这个 profile 的 `adb_controller` 路径
改指向这个新脚本（这一步不在本 PR 里，PR 合并后手动切换）。

## 验收标准
- [ ] `adb-controller-bridge.sh --profile realmachine-smoke preflight` 能返回真实的
      设备/账号验证结果（对着真机跑通）
- [ ] `snapshot` / `tap-evidence` / `swipe-evidence` 能在真机上产生可观察效果（截图和上次
      手动验证一致）
- [ ] 单元测试覆盖参数解析、profile 映射、错误码透传
- [ ] CI 全绿
