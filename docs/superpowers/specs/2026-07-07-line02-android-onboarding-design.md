# Line02 安卓客户端自助装机绑定(第一刀·深链扫码) —— 设计

**Goal:** 让客户不碰 adb/命令行，在 dashboard 下载安卓 agent → 装 → app 引导开无障碍 → 手机扫码自动绑定到自己账号 → dashboard 见机器在线 → 点关键词手机自动采集。

**Architecture:** 四端各一薄片，全部复用现有链路——(1) 后端加一个 session 鉴权端点，吐 `{apk_url(COS 常量), deeplink, license_key}`；(2) 前端克隆 AgentDownloadPage 出安卓下载页(下载按钮 + `qrcode.react` 渲染深链二维码 + 授权引导) + AreaHub 磁贴；(3) 安卓加"无障碍检测→引导跳系统设置"UI + 深链 intent-filter 解析 license 自动走**现有** register；(4) android CI 加一步 coscmd 上传 Release APK 到固定 COS 路径。register 端点、license 体系、心跳、机器列表全部零改动复用。

**Tech Stack:** Express + better-auth session(apps/api)、React + vite + qrcode.react(apps/dashboard)、Kotlin/Android(services/agent-android)、GitHub Actions + coscmd。

## Global Constraints(护栏，改动必须遵守)

- **客户路径零命令行**：下载/授权/绑定全程只在网页 + 手机上点击/扫码完成；adb/scrcpy 只允许出现在开发者调试文档，不进客户 Golden Path。
- **复用不改 register**：`POST /api/agent/register`(agent.ts:26)零改动，安卓已传 `os_type:"android"`；绑定靠深链把 license 灌进 `config.licenseKey` 后由现有 AgentService 触发 register。
- **不污染桌面下载链路**：安卓分发**新增独立端点/常量**，禁止改 `install-pack-manifest.ts` 的 `InstallPackManifest` schema 或 GET `/manifest`(桌面 tar.gz 专用)。
- **鉴权对称**：安卓分发端点与桌面 `/download`/`/dotenv` 一致，用 better-auth session(`auth.api.getSession`)，无 session → 401 `UNAUTHORIZED`。
- **二维码零新依赖**：用已在的 `qrcode.react`，不加 npm 包(避免 package-lock 同步坑)。
- **安卓 lint 无 os_type 扩表**：本刀不改 `agents.os_type` 枚举、不做 device_type 区分展示，安卓设备复用现有 machine 语义写入。

---

## 组件与数据流

```
dashboard 安卓下载页(已登录, better-auth session cookie)
  │ GET /api/agent/install-pack/android   ← 同源, cookie 自动带
  ▼
后端 android 端点(session 鉴权, 查 active license)
  │ 返回 { apk_url: <COS常量>, deeplink: "zenithjoy://bind?license=<key>&api=<base>", license_key, version }
  ▼
前端: 【下载 APK 按钮 href=apk_url】 + 【QRCodeSVG value=deeplink】 + 【激活码明文+复制(兜底)】 + 授权图文引导
  ▼
客户手机浏览器打开页 → 下 APK → 装(允许未知来源) → 开 app
  ▼
安卓 app 首屏: 检测无障碍未开 → 引导卡片「开启无障碍」→ 跳 ACTION_ACCESSIBILITY_SETTINGS → 客户开启采集服务 → 返回显示 ✅
  ▼
客户系统相机/微信扫 dashboard 二维码 → 深链 zenithjoy://bind?... 唤起 app(intent-filter)
  ▼
MainActivity.onCreate 解析 intent.data → parseBindDeepLink 取 license+api → 写 config → startAgentService()
  ▼
AgentService(现有) 读 config.licenseKey → POST /api/agent/register → 绑租户 → 心跳
  ▼
dashboard 机器管理页 GET /api/agent/machines → 这台手机在线(绿点)
```

## 组件详解

### 1. 后端 APK 分发端点(apps/api/src/routes/agent-install-pack.ts)

新增 `GET /api/agent/install-pack/android`：
- 鉴权：`auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`；无 `session.user.id` → 401 `{ error: 'UNAUTHORIZED' }`(与 `/download` 一致)。
- 查 active license：`SELECT license_key ... FROM zenithjoy.licenses WHERE customer_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`(复用 `/download` 同款查询)。查不到 → 用空 license_key(仍返 apk_url，deeplink 省略 license 参数，前端提示先激活)。
- 返回 JSON：
  ```json
  {
    "apk_url": "<ANDROID_APK_COS_URL or 常量>",
    "deeplink": "zenithjoy://bind?license=<key>&api=<agentBase>",
    "license_key": "<key or ''>",
    "version": "<APK versionName 常量, 如 1.0.0-android>"
  }
  ```
- `apk_url` 常量：`process.env.ANDROID_APK_COS_URL || 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/android/zenithjoy-agent.apk'`。
- `deeplink` 的 `api` 参数：复用 dotenv 端点推导 agent api base 的现有逻辑(env `AGENT_PUBLIC_WS_URL`/`AGENT_PUBLIC_BASE_URL`)，取 https base 供安卓 `deriveHttpBase()` 用。
- mount：已在 `app.use('/api/agent/install-pack', agentInstallPackRouter)`(app.ts:151)，只加 route，无需改 mount。
- **不改** GET `/manifest` / `/download` / `/dotenv`。

### 2. 前端安卓下载页(apps/dashboard)

- 新文件 `src/pages/AndroidDownloadPage.tsx`：克隆 AgentDownloadPage 结构，五段 → 精简为【激活码卡】【下载 APK + 二维码卡】【安装引导】【授权引导】【绑定状态徽标】。
  - 拿数据：`useQuery(['android-install-pack'], getAndroidInstallPack)`，拿 `{ apk_url, deeplink, license_key, version }`。
  - 下载按钮：`<a href={apk_url} download>下载安卓客户端 (APK)</a>`。
  - 二维码：`import { QRCodeSVG } from 'qrcode.react'` → `<QRCodeSVG value={deeplink} size={200} />` + 下方明文 `license_key` + 复制按钮(兜底手输)。
  - 授权引导：图文步骤"装好后打开 app → 点『开启无障碍』→ 在系统设置里打开『抖音采集/养号』→ 返回扫此码绑定"。
  - 绑定状态：复用现有 `/api/agent/machines` 或 `/api/agent/me/status` 轮询，显示"已绑定手机 N 台/在线"。
- 新 api 函数 `src/api/walking-skeleton-1.api.ts` 加 `getAndroidInstallPack()` → `request<AndroidInstallPack>('/agent/install-pack/android')`，type `AndroidInstallPack { apk_url; deeplink; license_key; version }`。
- 路由：`src/config/navigation.config.ts` 加 route `/dashboard/android`(lazy 映射 AndroidDownloadPage)。
- 入口磁贴：`src/pages/AreaHubPage.tsx` 加「下载安卓客户端」磁贴 `to="/dashboard/android"`(挂智能获客区)。

### 3. 安卓 app(services/agent-android)

- **无障碍检测(纯逻辑，可测)** 新文件 `app/src/main/kotlin/com/zenithjoy/agent/onboarding/AccessibilityGuide.kt`：
  - `fun isServiceEnabled(enabledSetting: String?, pkg: String, serviceClass: String): Boolean`：纯函数，解析 `enabled_accessibility_services` 格式 `pkg/cls:pkg/cls`，判目标 `pkg/serviceClass` 是否在内(大小写敏感、按 `:` 拆、trim)。
  - `fun collectServiceEnabled(context): Boolean`：读 `Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)` → `isServiceEnabled(it, "com.zenithjoy.agent", "com.zenithjoy.agent.collect.DouyinCollectService")`。
  - `const val ACCESSIBILITY_SETTINGS_ACTION = Settings.ACTION_ACCESSIBILITY_SETTINGS`。
- **深链解析(纯逻辑，可测)** 新文件 `app/src/main/kotlin/com/zenithjoy/agent/onboarding/BindDeepLink.kt`：
  - `data class BindParams(val license: String?, val api: String?)`
  - `fun parseBindDeepLink(uriString: String?): BindParams`：仅接受 `zenithjoy://bind?...`，用 `Uri.parse` 取 query `license`/`api`；scheme/host 不匹配返回 `BindParams(null,null)`。
- **MainActivity.kt 改动**：
  - `onCreate`：先 `val bind = parseBindDeepLink(intent?.data?.toString())`；若 `bind.license` 非空 → `config.licenseKey=bind.license; bind.api?.let{config.apiUrl=it}; startAgentService(); showStatus()`(深链绑定路径，免手输)。
  - `showLicenseInput()`/`showStatus()` 顶部插入无障碍状态区：若 `!collectServiceEnabled(this)` → 显眼卡片「⚠️ 无障碍未开启，采集无法运行」+ 按钮 `startActivity(Intent(ACCESSIBILITY_SETTINGS_ACTION))`；已开 → 「无障碍 ✅ 已开启」。`onResume` 复检刷新(客户从设置返回即更新)。
  - showStatus 增加"无障碍状态"行。
- **AndroidManifest.xml 改动**：MainActivity 现有 MAIN/LAUNCHER intent-filter 之外，**新增一个** `<intent-filter>`：`<action android:name="android.intent.action.VIEW"/>` + `<category DEFAULT/>` + `<category BROWSABLE/>` + `<data android:scheme="zenithjoy" android:host="bind"/>`。不动其它。

### 4. CI(.github/workflows/android-agent-ci.yml)

在 `gradle assembleRelease`(L75)与 `Upload release APK`(L77)之间新增一步(仅 push 到默认分支时执行，PR 不上传避免污染)：
```yaml
- name: Upload APK to COS
  if: github.ref == 'refs/heads/main'
  env:
    COS_SECRET_ID: ${{ secrets.COS_SECRET_ID }}
    COS_SECRET_KEY: ${{ secrets.COS_SECRET_KEY }}
  run: |
    pip install coscmd -q
    BUCKET="zenithjoy-static-1333590468"
    ENDPOINT="cos.accelerate.myqcloud.com"
    COS_PATH="/install-pack/android/zenithjoy-agent.apk"
    APK=$(ls app/build/outputs/apk/release/*.apk | head -1)
    coscmd config -a "$COS_SECRET_ID" -s "$COS_SECRET_KEY" -b "$BUCKET" -e "$ENDPOINT"
    coscmd upload "$APK" "$COS_PATH" --force
    echo "Uploaded: https://${BUCKET}.${ENDPOINT}${COS_PATH}"
```
(working-directory 已是 services/agent-android，故 APK 相对路径。)保留现有 upload-artifact 步骤。

## 错误处理

- **未登录访问 android 端点** → 401 `UNAUTHORIZED`，前端引导去 `/signup`(同 AgentDownloadPage)。
- **无 active license** → 端点仍返 apk_url(客户能下包)，deeplink 省略 license，前端提示"请先激活套餐再绑定"。
- **无障碍被系统关/掉线** → app `onResume` 复检 → 首屏重新弹引导卡片；dashboard 机器列表该手机 3 分钟心跳窗过后转离线红点。
- **激活码无效/机器数超配额** → 现有 register 返 401 `INVALID_LICENSE` / 403 `LICENSE_DEVICE_LIMIT_EXCEEDED`；AgentService 拿到失败 → app showStatus 显示未绑定(现有逻辑)，客户可重置 license 重试。
- **扫码扫不动/未装 app** → 二维码旁明文激活码 + 复制按钮兜底，客户可 app 内手输(现有 showLicenseInput)。
- **深链 scheme 不匹配** → `parseBindDeepLink` 返回空 → 走正常首屏(不崩)。

## 测试策略

- **安卓 unit(纯逻辑，JUnit `testDebugUnitTest`)**：
  - `parseBindDeepLink`：`zenithjoy://bind?license=ZJ-F-A1B2C3D4&api=https://x` → license/api 正确取出；错误 scheme(`http://...`)/缺 query/null → 返回空；`license` 含 URL 编码正确解码。
  - `isServiceEnabled`：给定 `enabled_accessibility_services` 串 + 目标 → 命中/未命中/空串/null/多服务混排 各一例。
- **后端 vitest(apps/api)**：`GET /api/agent/install-pack/android` —— (a) 无 session → 401 `UNAUTHORIZED`；(b) 有 session + active license → 200 且 `apk_url` 是 COS URL、`deeplink` 以 `zenithjoy://bind?` 开头且含 license、`license_key` 正确；(c) 有 session 无 license → 200 且 deeplink 不含 license 参数。用现有 test 的 session mock 约定。
- **前端**：`AndroidDownloadPage` 轻量渲染——mock `getAndroidInstallPack` 返回样例 → 断言下载按钮 href=apk_url、二维码组件收到 deeplink、激活码文本出现。(dashboard 全量测试环境有 worktree symlink 坑，仅跑本文件。)
- **smoke.sh** `.github/workflows/scripts/smoke/android-onboarding-smoke.sh`(真链)：curl 端点无 cookie → 401；带 seeded better-auth session → 200 且 `apk_url` 是 COS 直链、`deeplink` 以 `zenithjoy://bind?` 开头。(APK 真实可下由 COS `curl -I` 检查该常量 URL 返 200/可达，若 CI 未上传过则跳过并 log。)
- **CI 守卫**：android CI `testDebugUnitTest` 跑上述安卓 unit；`lint-feature-has-smoke`/`lint-tdd-commit-order` 门禁。
- **E2E(Honor100 真机手动，用户在场)**：staging 安卓下载页 → 下 APK → 装 → app 引导开无障碍(跳设置开启)→ 系统相机扫二维码唤起 app 自动绑定 → dashboard 机器列表见该手机在线 → dashboard 点「麻婆豆腐」→ 手机采集出 Lead。**全程不碰命令行。** 这是真机接缝，CI 测不到，靠真机验收兜底；app 首屏无障碍自检卡片=运行时自检守卫，装到客户机自跑自显。

## 不包含(下一刀)

app 内相机扫码器、一次性绑定 token、`os_type=android` 的 device_type 语义区分展示、APK 版本管理/manifest 文件/强制升级、多号批量装机。
