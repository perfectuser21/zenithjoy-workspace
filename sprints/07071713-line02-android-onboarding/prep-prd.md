# PrepPRD：客户智能获客(Line02) — 安卓客户端自助装机绑定(第一刀·深链扫码)

## 本次对话涵盖的所有事项(防信息丢失)
- [x] 本 PrepPRD 包含：dashboard 安卓下载页 + APK 传 COS 分发 + 安卓 app 无障碍权限检测/引导跳设置 + 深链扫码自动绑定(激活码二维码)
- [ ] 另立 Sprint(本次不做)：app 内相机扫码器、免手输的一次性绑定 token、`os_type=android` 机器列表 device_type 区分展示、多抖音号装机批量绑
- [ ] 待讨论：无

## Journey 当前状态(Line02 客户智能获客 afa6abca)
- ✅ 网页输入关键词→中台带租户下发→安卓 agent 拉到采集任务(PR#1152，采集主链 P0 已通)
- ✅ 账号扫描/养号+验活合一真机跑通(PR#1148/#1149)
- ✅ 机器管理(客户机器+机器上抖音号绑定) medium/working — 后端 license/register/心跳/机器列表可复用
- ⬜ **安卓客户端自助装机绑定** — 本刀新增 thin(客户下载→装→授权→绑定全程不碰命令行)

## 本次要做的
把"客户装 app 就自助配置好"的正常流程做出来，**替代现在靠开发者 adb 装包 + adb 授权无障碍 + 手写 prefs 的土办法**。客户在 dashboard 下载安卓客户端，装上后 app 引导开无障碍权限(点几下跳系统设置)，用手机扫网页上的二维码自动绑定到自己账号，之后只在 dashboard 点关键词，手机自动采集。

## Golden Path(客户操作流程，单线性，全程不碰命令行)

1. 客户在 dashboard 智能获客区点「下载安卓客户端」磁贴 → 系统打开安卓下载页，页面显示【下载 APK 按钮】+【绑定二维码(编码本租户激活码)】+【安装/授权图文引导】
2. 客户用手机浏览器打开该页 → 点「下载 APK」→ 浏览器从 COS 直链下载 APK → 点开安装(安卓弹「允许安装未知来源」一次性系统提示，客户点允许)
3. 客户打开 app → app 检测到无障碍权限未开 → 首屏显眼引导卡片「开启无障碍权限」+ 按钮 → 点按钮跳转系统无障碍设置页 → 客户开启「抖音采集/养号」服务 → 返回 app → app 显示【无障碍 ✅ 已开启】
4. 客户用手机系统相机/微信扫一扫，扫 dashboard 安卓页上的绑定二维码 → 唤起 zenithjoy app(深链 `zenithjoy://bind?license=ZJ-F-xxxx&api=...`)→ app 读出激活码 → 自动 POST /api/agent/register 绑定到该租户 → app 显示【已绑定·Agent 在线】→ dashboard 机器列表出现这台手机(在线绿点)
5. (已有)客户在手机上登抖音小号
6. (已通 PR#1152)客户回 dashboard 智能获客页输入「麻婆豆腐」点搜索 → 手机被唤醒自动采集 → 出 Lead

> 补充场景(出错恢复)：
> - **无障碍被系统关掉/掉线** → app 首屏重新弹出「开启无障碍权限」引导卡片；dashboard 机器列表该手机变离线红点 → 客户重新点按钮跳设置开启即可。
> - **激活码无效 / 机器数超配额** → register 返回 4xx(如 403 LICENSE_DEVICE_LIMIT_EXCEEDED) → app 显示「激活码无效 / 机器数已达上限」，客户联系升级或换码。
> - **扫码扫不动 / 未装 app** → 二维码旁提供「激活码明文 + 复制按钮」兜底，客户可在 app 内手动粘贴激活码绑定(现有输入框)。

## 客户视角(打开产品能感知到什么)
- dashboard 智能获客区多了一个「下载安卓客户端」入口，点进去能下 APK、看到自己的绑定二维码和激活码、有清晰的安装授权步骤。
- 手机上装好 app 后，app 会主动提示开权限、扫码就绑好，全程不需要电脑、不需要任何命令行。
- 绑好后 dashboard 能看到「这台手机在线」。

## 完成后用户能
1. 不碰 adb/scrcpy/命令行，纯在网页+手机上完成安卓客户端的下载、授权、绑定。
2. 在 dashboard 看到自己绑定的安卓手机在线状态。

## 涉及的 Ability / Feature
- 安卓客户端自助装机绑定(新增 feature，thin) — journey afa6abca

## 不包含(下一刀)
- app 内相机扫码器(本刀用深链，系统相机即可)
- 一次性绑定 token(本刀二维码直接编码 license，与明文激活码同等安全级别)
- `os_type=android` 机器列表 device_type 语义区分展示(本刀安卓设备复用现有 machine 语义写入 agents/license_machines)
- APK 版本管理/灰度/强制升级

## 前置工作(已逐项确认，无 TBD)

### 账号与登录
- [x] Honor100 测试机(操作号 perfect21xx 秦军餐饮) — 本机 USB 连用户电脑，用户在场真机验收
- [x] staging dashboard — 已起(staging-autopilot.zenjoymedia.media，proxy 到 mac 本机 :5201)

### API 与凭据
- [x] COS 上传凭据 — GHA Secrets `COS_SECRET_ID` / `COS_SECRET_KEY` 已配(现 install-pack CI 在用)
- [x] 安卓签名 keystore — GHA Secrets `ANDROID_RELEASE_KEYSTORE_B64` 等已配，CI 已产签名 release APK

### E2E 测试账号
- [x] 测试租户 — staging zenithjoy_test 内已有租户 + license(Honor100 复用现有绑定的租户)
- [x] 登录方式 — dashboard better-auth session(客户网页已登录态)

### 测试 Fixture
- [x] 无需外部素材 — APK 由 android CI 自产

### 基础设施
- [x] COS 上传机制 — coscmd 上传 `cos.accelerate.myqcloud.com`，路径约定 `/install-pack/android/zenithjoy-agent.apk`
- [x] 后端 register/心跳/机器列表端点 — 已存在可复用(`/api/agent/register`、`/api/agent/heartbeat`、`/api/agent/machines`)

## 验收标准(Final E2E)
- [ ] **后端 smoke(CI 真链)**：`GET /api/agent/install-pack/android`(或 manifest 含 `apk_url`)返回可下载的 APK COS 直链(HTTP 200/302 + Content-Type/大小合理)；未登录→401。
- [ ] **前端**：安卓下载页渲染下载按钮 + 二维码 + 激活码 + 授权引导；AreaHub 有「下载安卓客户端」磁贴入口。
- [ ] **安卓 unit/lint**：无障碍权限检测函数(读 enabled_accessibility_services 判断三个服务是否在内)有单测；深链解析(从 `zenithjoy://bind?license=...` 取出 license)有单测；CI `testDebugUnitTest` 绿。
- [ ] **CI**：android workflow 新增 coscmd 上传 APK 到 COS 步骤成功；lint-feature-has-smoke / lint-tdd-commit-order 等门禁全绿。
- [ ] **Honor100 真机 E2E(手动，用户在场)**：网页下 APK→装→app 引导开无障碍(跳设置开启)→扫二维码唤起 app 自动绑定→dashboard 机器列表见该手机在线→dashboard 点「麻婆豆腐」→手机采集出 Lead。**全程不碰命令行。**

## 守卫(哨兵)
- **逻辑接缝(CI test)**：无障碍权限检测解析、深链 license 解析、后端 APK 端点鉴权/返回 → regression test 留 CI。
- **环境接缝(真机，CI 测不到)**：无障碍引导跳设置、系统相机深链唤起 app、真机 register 绑定 → Honor100 真机验收兜底；app 首屏权限状态自检(检测未开显红卡片)即"运行时自检"守卫，装到客户机自跑自显。
