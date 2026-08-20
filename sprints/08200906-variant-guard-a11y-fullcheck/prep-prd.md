# Bug PrepPRD：客户机上双包并存 + 无障碍只查 1/3

task-id: 90dec92f-2302-40f3-b36c-2a128c8d3d8b
GP-Anchor: line02/keyword_acquisition keep-green

## 症状
1. 设备上同时装着 `com.zenithjoy.agent`(prod) 与 `com.zenithjoy.agent.e2e`(开发变体)。
   客户在系统无障碍列表里看到**两个同名「ZenithJoy Agent」**，点错一个 → 界面显示"已开启"、
   软件就是不干活。0819 小白 realme RMX3478 整晚干不了活就是这个原因。
   对照实验（0820）：小黄 MAA-AN00 同样双包并存，只因授权点在 prod 包上就一切正常。
2. `MainActivity.accessibilityBanner()` 用 `collectServiceBound()`，只查 3 个无障碍服务里的
   **第 1 个**（采集）。客户开了采集没开私信 → 横幅显示绿、私信/账号扫描静默全死。

## 根因
1. **分发纪律缺口**：`.e2e` 是 `applicationIdSuffix` 产生的开发变体，本不该出现在客户机上，
   而 App 自己完全不检测这件事。BYOD 场景下客户手机型号不可控，但"我们自己把开发包漏过去"
   与机型无关，是 100% 可根除的自造坑。
2. **自检口径不全**：banner 只看第一个服务，`AgentService` 启动自检虽已全查（PR #1668），
   但客户看的是 UI 不是 logcat。

## 关联上下文
- 铁律 2dc450f7「判据必须用不会撒谎的那个」——本刀是它在 UI 层的延续
- 决策 44cb3e8e（0819 小白三层根因）
- PR #1668 已上线真 Bound + 本进程包名判据，本刀复用其 `checkSelfAccessibility()`

## 修法
### 刀① 同族变体包互斥闸
- `AndroidManifest.xml` 的 `<queries>` 补两个变体包名（安卓 11+ 不声明查不到，
  且是"合法失败返回 null"而非抛异常——manifest 里已有同款教训注释）
- 新增纯函数 `siblingVariantPackages(selfPackage)`：prod ↔ .e2e 互推
- 新增纯函数 `judgeVariantConflict(...) : VariantVerdict`，**分级**：
  | 情况 | 判定 |
  |---|---|
  | 无同族包 | `OK` |
  | 有同族包 + 本包三服务全绑 | `WARN`（黄条 + 一键卸载，**不阻断**）|
  | 有同族包 + 本包缺服务 + 服务被同族包持有 | `BLOCK`（红屏 + 一键卸载 + 点名）|
  | 有同族包 + 本包缺服务 + 同族包也没持有 | `WARN`（缺服务归无障碍横幅管，不重复报）|
- 一键卸载：`Intent(ACTION_DELETE, "package:<sibling>")` 拉起系统卸载确认框
- **BLOCK 时 AgentService 照常心跳**——绝不能把设备变哑，中台必须还看得见"活着但未就绪"

### 刀② 无障碍横幅改全查
- banner 从 `collectServiceBound()`（只查第 1 个）改为 `checkSelfAccessibility(this)`（全查 3 个）
- 缺哪个说哪个，并复用 `describe()` 点名"被哪个包拿走了"

## Regression Test 计划（纯 JVM 单测，逻辑接缝）
- `siblingVariantPackages`：prod→[.e2e]、.e2e→[prod]、无关包名→空
- `judgeVariantConflict` 四种组合各一条，**其中小白场景=BLOCK、小黄场景=WARN 是核心两条**
- 源码级机械闸：banner 不许再引用 `collectServiceBound`（防回退）

> 环境接缝部分（真机上真的能弹出卸载框）由真机验证覆盖，不在 CI。

## 不包含
- 就绪度上报中台（层三，需改心跳协议，另立项走 /capability）
- 厂商专项引导 / 直达开关页（层二，机型矩阵，持续投入）

## 验收标准
- [ ] commit-1 失败测试先提交
- [ ] commit-2 实现让测试变绿
- [ ] proven-to-fire：变异测试（把 BLOCK 降成 WARN、把全查改回只查第一个）各自报红
- [ ] CI 全绿
- [ ] 小黄场景判定为 WARN（不阻断），小白场景判定为 BLOCK
