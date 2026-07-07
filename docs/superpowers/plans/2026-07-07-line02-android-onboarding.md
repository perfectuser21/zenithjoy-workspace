# 安卓客户端自助装机绑定(第一刀·深链扫码) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户在 dashboard 下载安卓 agent → 装 → app 引导开无障碍 → 手机扫码自动绑定 → dashboard 见在线 → 点关键词手机采集，全程零命令行。

**Architecture:** 四端各一薄片复用现有链路——后端加 session 鉴权端点吐 `{apk_url, deeplink, license_key}`；前端克隆下载页 + 二维码；安卓加无障碍引导 + 深链解析走现有 register；CI 上传 APK 到 COS。

**Tech Stack:** Express + better-auth(apps/api)、React + vite + qrcode.react(apps/dashboard)、Kotlin/Android(services/agent-android)、GitHub Actions + coscmd。

## Global Constraints

- 客户路径零命令行；`POST /api/agent/register`(agent.ts:26)零改动复用；不改 `install-pack-manifest.ts` schema 与桌面 `/manifest`/`/download`/`/dotenv`；android 端点用 better-auth session，无 session → 401 `UNAUTHORIZED`；二维码用已在依赖 `qrcode.react` 零新包；不改 `agents.os_type` 枚举。
- **安卓单测在 JVM(`testDebugUnitTest`)跑，禁止在被测纯函数里用 `android.net.Uri`/`Settings`**——深链解析用纯 Kotlin 字符串 + `java.net.URLDecoder`；`Settings.Secure` 只出现在 `collectServiceEnabled(context)`(不进单测)。
- 工作 worktree=`/Users/administrator/worktrees/zenithjoy/line02-android-onboarding`，一律绝对路径 + `git -C` 操作。

---

## File Structure

- `apps/api/src/routes/agent-install-pack.ts` — 加 `GET /android`(改)
- `apps/api/src/routes/agent-install-pack.test.ts` — android 端点测试(新，若已存在则追加 describe)
- `apps/dashboard/src/api/walking-skeleton-1.api.ts` — 加 `getAndroidInstallPack()`(改)
- `apps/dashboard/src/pages/AndroidDownloadPage.tsx` — 安卓下载页(新)
- `apps/dashboard/src/pages/AndroidDownloadPage.test.tsx` — 渲染测试(新)
- `apps/dashboard/src/config/navigation.config.ts` — 加 route + lazy(改)
- `apps/dashboard/src/pages/AreaHubPage.tsx` — 加磁贴(改)
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/onboarding/BindDeepLink.kt` — 深链解析(新)
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/onboarding/AccessibilityGuide.kt` — 无障碍检测(新)
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/onboarding/BindDeepLinkTest.kt` — 深链单测(新)
- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/onboarding/AccessibilityGuideTest.kt` — 检测单测(新)
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt` — 深链 + 无障碍卡片(改)
- `services/agent-android/app/src/main/AndroidManifest.xml` — MainActivity 加深链 intent-filter(改)
- `.github/workflows/android-agent-ci.yml` — 加 coscmd 上传 APK 步骤(改)
- `.github/workflows/scripts/smoke/android-onboarding-smoke.sh` — smoke(新)

---

### Task 1: 后端 APK 分发端点 GET /api/agent/install-pack/android

**Files:**
- Modify: `apps/api/src/routes/agent-install-pack.ts`(在 `/dotenv` 后追加)
- Test: `apps/api/src/routes/agent-install-pack.test.ts`

**Interfaces:**
- Produces: `GET /api/agent/install-pack/android` → 401 `{ok:false,code:'UNAUTHORIZED'}` | 200 `{apk_url:string, deeplink:string, license_key:string, version:string}`

- [ ] **Step 1: 写 failing 测试**

先看仓库现有对 `auth.api.getSession` 的测试 mock 风格：若 `apps/api/src/routes/agent-install-pack.test.ts` 已存在，沿用它 mock session/pool 的方式追加；若不存在，参照仓库任一 install-pack/agent 端点测试（grep `getSession` in `apps/api/src/routes/*.test.ts`）复制其 mock 骨架。测试三例：

```ts
// 追加到（或新建）agent-install-pack.test.ts
describe('GET /api/agent/install-pack/android', () => {
  it('无 session → 401 UNAUTHORIZED', async () => {
    mockGetSession(null); // 按本文件既有 mock helper：使 auth.api.getSession 返回 null
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('有 session + active license → 200，apk_url 是 COS 直链，deeplink 带 license', async () => {
    mockGetSession({ user: { id: 'user-1' } });
    mockPoolQueryOnce([{ license_key: 'ZJ-F-A1B2C3D4' }]); // 使 pool.query 返回一条 license
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.apk_url).toMatch(/^https:\/\/.*\.myqcloud\.com\/install-pack\/android\/zenithjoy-agent\.apk$/);
    expect(res.body.deeplink).toMatch(/^zenithjoy:\/\/bind\?/);
    expect(res.body.deeplink).toContain('license=ZJ-F-A1B2C3D4');
    expect(res.body.license_key).toBe('ZJ-F-A1B2C3D4');
  });

  it('有 session 无 license → 200，deeplink 不含 license 参数', async () => {
    mockGetSession({ user: { id: 'user-2' } });
    mockPoolQueryOnce([]); // 无 license
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.license_key).toBe('');
    expect(res.body.deeplink).not.toContain('license=');
    expect(res.body.deeplink).toContain('api=');
  });
});
```

> `mockGetSession`/`mockPoolQueryOnce` 是占位名——实现时替换成本测试文件已有的 mock 手法（vi.mock('../auth') 与 vi.mock('../db') 或等价）。关键断言不变。

- [ ] **Step 2: 跑测试确认 RED**

Run: `cd /Users/administrator/worktrees/zenithjoy/line02-android-onboarding/apps/api && npx vitest run src/routes/agent-install-pack.test.ts`
Expected: FAIL（端点不存在 → 404，或 describe 报错）

- [ ] **Step 3: 实现端点**

在 `agent-install-pack.ts` 的 `/dotenv` 端点之后追加（复用文件顶部已 import 的 `auth`/`fromNodeHeaders`/`pool`）：

```ts
// 安卓 APK 分发 + 深链绑定信息（Line02 客户自助装机绑定第一刀）
// 复用 /download 同款 session 鉴权 + active license 查询；不改桌面 manifest。
agentInstallPackRouter.get('/android', async (req: Request, res: Response) => {
  // 1. 鉴权（同 /download）
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const u = session?.user;
    if (u && typeof u.id === 'string' && u.id.length > 0) userId = u.id;
  } catch (err) {
    console.warn('[install-pack/android] session 解析失败:', err);
  }
  if (!userId) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
  }

  // 2. 查 active license（无则空串，仍返 apk_url 让客户先下包）
  let licenseKey = '';
  try {
    const { rows } = await pool.query<{ license_key: string }>(
      `SELECT license_key FROM zenithjoy.licenses
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (rows.length > 0) licenseKey = rows[0].license_key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: msg });
  }

  // 3. apk_url（COS 常量）+ deeplink（api=ws url，安卓 deriveHttpBase 会 wss→https 做 register）
  const apkUrl =
    process.env.ANDROID_APK_COS_URL ||
    'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/android/zenithjoy-agent.apk';
  const wsUrl = process.env.AGENT_PUBLIC_WS_URL || 'wss://api.zenithjoy.com/agent-ws';
  const parts = [`api=${encodeURIComponent(wsUrl)}`];
  if (licenseKey) parts.unshift(`license=${encodeURIComponent(licenseKey)}`);
  const deeplink = `zenithjoy://bind?${parts.join('&')}`;

  return res.status(200).json({
    apk_url: apkUrl,
    deeplink,
    license_key: licenseKey,
    version: '1.0.1',
  });
});
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `cd .../apps/api && npx vitest run src/routes/agent-install-pack.test.ts`
Expected: PASS（3 例全绿）。再跑 `npx tsc --noEmit`（本包）确认无类型错误。

- [ ] **Step 5: commit**

```bash
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding add apps/api/src/routes/agent-install-pack.ts apps/api/src/routes/agent-install-pack.test.ts
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding commit -m "feat(api): 安卓 APK 分发端点 GET /install-pack/android(session鉴权+deeplink)"
```

---

### Task 2: 前端安卓下载页 + api + 路由 + 磁贴

**Files:**
- Modify: `apps/dashboard/src/api/walking-skeleton-1.api.ts`
- Create: `apps/dashboard/src/pages/AndroidDownloadPage.tsx`
- Test: `apps/dashboard/src/pages/AndroidDownloadPage.test.tsx`
- Modify: `apps/dashboard/src/config/navigation.config.ts`
- Modify: `apps/dashboard/src/pages/AreaHubPage.tsx`

**Interfaces:**
- Consumes: `getAndroidInstallPack()` → `AndroidInstallPack { apk_url; deeplink; license_key; version }`

- [ ] **Step 1: 加 api 函数**（先加，测试要 mock 它）

在 `walking-skeleton-1.api.ts` 末尾（参照同文件 `getInstallPackManifest`，L185 附近的 `request<T>()` 用法）加：

```ts
export interface AndroidInstallPack {
  apk_url: string;
  deeplink: string;
  license_key: string;
  version: string;
}
export function getAndroidInstallPack(): Promise<AndroidInstallPack> {
  return request<AndroidInstallPack>('/agent/install-pack/android');
}
```

- [ ] **Step 2: 写 failing 渲染测试**

参照仓库现有 `*.test.tsx` 的渲染测试风格（grep `render(` in `apps/dashboard/src`；用其 QueryClient wrapper）。

```tsx
// AndroidDownloadPage.test.tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
vi.mock('../api/walking-skeleton-1.api', () => ({
  getAndroidInstallPack: vi.fn().mockResolvedValue({
    apk_url: 'https://cos.example.com/zenithjoy-agent.apk',
    deeplink: 'zenithjoy://bind?license=ZJ-F-A1B2C3D4&api=wss%3A%2F%2Fx',
    license_key: 'ZJ-F-A1B2C3D4',
    version: '1.0.1',
  }),
}));
// 用与其它页面测试相同的 renderWithProviders（QueryClientProvider + MemoryRouter）
it('渲染下载按钮、二维码、激活码', async () => {
  renderWithProviders(<AndroidDownloadPage />);
  const dl = await screen.findByRole('link', { name: /下载安卓客户端/ });
  expect(dl).toHaveAttribute('href', 'https://cos.example.com/zenithjoy-agent.apk');
  expect(await screen.findByText('ZJ-F-A1B2C3D4')).toBeInTheDocument();
  // 二维码：QRCodeSVG 渲染成 <svg>，断言存在
  expect(document.querySelector('svg')).toBeTruthy();
});
```

- [ ] **Step 3: 跑测试确认 RED**

Run: `cd .../apps/dashboard && npx vitest run src/pages/AndroidDownloadPage.test.tsx`
Expected: FAIL（AndroidDownloadPage 未定义）

- [ ] **Step 4: 实现页面**

`AndroidDownloadPage.tsx`（克隆 `AgentDownloadPage.tsx` 的内联样式骨架，精简为四段）：

```tsx
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { getAndroidInstallPack } from '../api/walking-skeleton-1.api';

export default function AndroidDownloadPage() {
  const q = useQuery({ queryKey: ['android-install-pack'], queryFn: getAndroidInstallPack, retry: false });
  const data = q.data;
  const copy = () => { if (data?.license_key) navigator.clipboard?.writeText(data.license_key); };
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>下载安卓客户端</h1>
      {q.isError && <p>请先登录后再下载（<a href="/signup">去登录/注册</a>）。</p>}
      {data && (
        <>
          {/* 激活码卡 */}
          <section style={{ background: '#fffbe6', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <div>你的激活码：<b>{data.license_key || '（尚未激活套餐）'}</b>
              {data.license_key && <button onClick={copy} style={{ marginLeft: 8 }}>复制</button>}</div>
            <div style={{ color: '#888', fontSize: 12 }}>版本 {data.version}</div>
          </section>
          {/* 下载 + 二维码卡 */}
          <section style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 16 }}>
            <div>
              <a href={data.apk_url} download
                 style={{ display: 'inline-block', padding: '12px 20px', background: '#2563eb', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>
                下载安卓客户端 (APK)
              </a>
              <p style={{ color: '#888', fontSize: 12 }}>用手机浏览器打开本页下载，或扫右侧二维码绑定。</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <QRCodeSVG value={data.deeplink} size={180} />
              <div style={{ fontSize: 12, color: '#888' }}>装好 app 后，手机扫此码自动绑定</div>
            </div>
          </section>
          {/* 授权引导 */}
          <section style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            <h3>安装与授权步骤</h3>
            <ol>
              <li>手机浏览器下载 APK → 点开安装（首次会提示「允许安装未知来源」，点允许）。</li>
              <li>打开 App → 点「开启无障碍权限」→ 在系统设置里打开「抖音采集/养号」服务 → 返回 App。</li>
              <li>用手机系统相机/微信「扫一扫」扫上方二维码 → 自动绑定到你的账号。</li>
              <li>在手机上登录抖音小号 → 回本站点关键词，手机自动采集。</li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 跑测试确认 GREEN**

Run: `cd .../apps/dashboard && npx vitest run src/pages/AndroidDownloadPage.test.tsx`
Expected: PASS。

> 若 dashboard 测试环境报 **worktree symlink 无关错误**（既往已知：node_modules 软链导致全量测试崩），只跑本文件；若本文件仍被环境阻断，记录到 report 并靠 CI/真机兜底，不阻塞（同采集那刀处置）。

- [ ] **Step 6: 接路由 + 磁贴**

`navigation.config.ts`：参照 L224 `agent` route 加一条 `{ path: 'dashboard/android', ... }`，并在 L79-124 lazy 映射区加 `AndroidDownloadPage: lazy(() => import('../pages/AndroidDownloadPage'))`（键名与 route 对应，照该文件既有写法）。
`AreaHubPage.tsx`：参照 L50 「机器管理」磁贴，在智能获客区加一块：`{ title: '下载安卓客户端', to: '/dashboard/android' }`（照该文件磁贴数组既有结构）。

- [ ] **Step 7: 类型检查 + commit**

Run: `cd .../apps/dashboard && npx tsc --noEmit`（无类型错误）

```bash
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding add apps/dashboard/src/api/walking-skeleton-1.api.ts apps/dashboard/src/pages/AndroidDownloadPage.tsx apps/dashboard/src/pages/AndroidDownloadPage.test.tsx apps/dashboard/src/config/navigation.config.ts apps/dashboard/src/pages/AreaHubPage.tsx
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding commit -m "feat(dashboard): 安卓下载页(APK+深链二维码+授权引导)+磁贴入口"
```

---

### Task 3: 安卓 app 无障碍引导 + 深链绑定

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/onboarding/BindDeepLink.kt`
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/onboarding/AccessibilityGuide.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/onboarding/BindDeepLinkTest.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/onboarding/AccessibilityGuideTest.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt`
- Modify: `services/agent-android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Produces: `parseBindDeepLink(uriString: String?): BindParams(license, api)`；`isServiceEnabled(enabledSetting, pkg, serviceClass): Boolean`；`collectServiceEnabled(context): Boolean`

- [ ] **Step 1: 写 failing 单测（JVM，纯逻辑）**

`BindDeepLinkTest.kt`：
```kotlin
package com.zenithjoy.agent.onboarding
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
class BindDeepLinkTest {
  @Test fun parses_license_and_api() {
    val p = parseBindDeepLink("zenithjoy://bind?license=ZJ-F-A1B2C3D4&api=wss%3A%2F%2Fx%2Fagent-ws")
    assertEquals("ZJ-F-A1B2C3D4", p.license)
    assertEquals("wss://x/agent-ws", p.api)
  }
  @Test fun wrong_scheme_returns_empty() {
    val p = parseBindDeepLink("http://bind?license=X")
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun no_query_returns_empty() {
    val p = parseBindDeepLink("zenithjoy://bind")
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun null_returns_empty() {
    val p = parseBindDeepLink(null)
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun license_only() {
    val p = parseBindDeepLink("zenithjoy://bind?license=ZJ-F-XXXX0000")
    assertEquals("ZJ-F-XXXX0000", p.license); assertNull(p.api)
  }
}
```

`AccessibilityGuideTest.kt`：
```kotlin
package com.zenithjoy.agent.onboarding
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
class AccessibilityGuideTest {
  private val pkg = "com.zenithjoy.agent"
  private val cls = "com.zenithjoy.agent.collect.DouyinCollectService"
  @Test fun hit_single() { assertTrue(isServiceEnabled("$pkg/$cls", pkg, cls)) }
  @Test fun hit_among_many() {
    assertTrue(isServiceEnabled("com.other/x.Y:$pkg/$cls:com.z/A.B", pkg, cls))
  }
  @Test fun miss() { assertFalse(isServiceEnabled("com.other/x.Y", pkg, cls)) }
  @Test fun empty() { assertFalse(isServiceEnabled("", pkg, cls)) }
  @Test fun null_setting() { assertFalse(isServiceEnabled(null, pkg, cls)) }
}
```

- [ ] **Step 2: 跑确认 RED**

Run: `cd /Users/administrator/worktrees/zenithjoy/line02-android-onboarding/services/agent-android && gradle :app:testDebugUnitTest --tests "com.zenithjoy.agent.onboarding.*"`
Expected: FAIL（未定义 parseBindDeepLink/isServiceEnabled）

- [ ] **Step 3: 实现纯逻辑**

`BindDeepLink.kt`（**不用 android.net.Uri**，纯字符串 + JVM URLDecoder，才能 JVM 单测）：
```kotlin
package com.zenithjoy.agent.onboarding
import java.net.URLDecoder

data class BindParams(val license: String?, val api: String?)

/** 仅接受 zenithjoy://bind?...，解析 query 里的 license/api。scheme/host 不符或无 query → 空。 */
fun parseBindDeepLink(uriString: String?): BindParams {
    if (uriString.isNullOrEmpty()) return BindParams(null, null)
    val base = "zenithjoy://bind"
    if (!uriString.startsWith("$base?")) return BindParams(null, null)
    val query = uriString.substring(base.length + 1)
    val params = query.split("&").mapNotNull { pair ->
        val i = pair.indexOf('=')
        if (i <= 0) null
        else pair.substring(0, i) to runCatching { URLDecoder.decode(pair.substring(i + 1), "UTF-8") }.getOrDefault(pair.substring(i + 1))
    }.toMap()
    return BindParams(params["license"], params["api"])
}
```

`AccessibilityGuide.kt`（`isServiceEnabled` 纯函数可测；`collectServiceEnabled` 用 Settings 不进单测）：
```kotlin
package com.zenithjoy.agent.onboarding
import android.content.Context
import android.provider.Settings

const val COLLECT_SERVICE_PKG = "com.zenithjoy.agent"
const val COLLECT_SERVICE_CLASS = "com.zenithjoy.agent.collect.DouyinCollectService"

/** 纯函数：enabled_accessibility_services 形如 pkg/cls:pkg/cls，判目标是否在内。 */
fun isServiceEnabled(enabledSetting: String?, pkg: String, serviceClass: String): Boolean {
    if (enabledSetting.isNullOrEmpty()) return false
    val target = "$pkg/$serviceClass"
    return enabledSetting.split(":").map { it.trim() }.any { it == target }
}

fun collectServiceEnabled(context: Context): Boolean {
    val setting = Settings.Secure.getString(
        context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    )
    return isServiceEnabled(setting, COLLECT_SERVICE_PKG, COLLECT_SERVICE_CLASS)
}
```

- [ ] **Step 4: 跑确认 GREEN**

Run: `cd .../services/agent-android && gradle :app:testDebugUnitTest --tests "com.zenithjoy.agent.onboarding.*"`
Expected: PASS（10 例）

- [ ] **Step 5: commit（纯逻辑 + 测试）**

```bash
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/onboarding/ services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/onboarding/
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding commit -m "feat(android): 深链解析+无障碍检测纯逻辑(JVM单测覆盖)"
```

- [ ] **Step 6: 接线 MainActivity + Manifest（UI 接缝，无 JVM 单测，靠真机）**

`MainActivity.kt` 改动：
1. import：`import android.provider.Settings`、`import android.widget.LinearLayout`、`import com.zenithjoy.agent.onboarding.parseBindDeepLink`、`import com.zenithjoy.agent.onboarding.collectServiceEnabled`。
2. `onCreate` 在 `config = AgentConfig(this)` 后、分支前插入深链处理：
```kotlin
val bind = parseBindDeepLink(intent?.data?.toString())
if (!bind.license.isNullOrEmpty()) {
    config.licenseKey = bind.license!!
    if (!bind.api.isNullOrEmpty()) config.apiUrl = bind.api!!
    startAgentService()
    showStatus()
    return
}
```
3. 新增私有方法，供 showLicenseInput/showStatus 复用，返回一个无障碍状态 View：
```kotlin
private fun accessibilityBanner(): android.view.View {
    val enabled = collectServiceEnabled(this)
    return if (enabled) {
        TextView(this).apply { text = "无障碍 ✅ 已开启" }
    } else {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        box.addView(TextView(this).apply { text = "⚠️ 无障碍未开启，采集无法运行" })
        box.addView(Button(this).apply {
            text = "开启无障碍权限"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })
        box
    }
}
```
4. 在 `showLicenseInput()` 与 `showStatus()` 的 layout `addView` 序列**最前面**各插 `layout.addView(accessibilityBanner())`。
5. `showStatus()` 的 status 文本追加一行：`appendLine("无障碍: ${if (collectServiceEnabled(this@MainActivity)) "已开启" else "未开启"}")`。
6. 新增 `override fun onResume()`：`super.onResume(); if (config.isConfigured) showStatus() else showLicenseInput()`（从系统设置返回后刷新权限状态）。

`AndroidManifest.xml` 改动：在 `.MainActivity` 的 `<activity>` 内、现有 MAIN/LAUNCHER intent-filter 之后，新增：
```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="zenithjoy" android:host="bind" />
</intent-filter>
```

- [ ] **Step 7: 编译确认（assembleDebug 不跑真机）**

Run: `cd .../services/agent-android && gradle :app:assembleDebug`
Expected: BUILD SUCCESSFUL（编译通过；真机行为靠 Honor100 手动验）

- [ ] **Step 8: commit**

```bash
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt services/agent-android/app/src/main/AndroidManifest.xml
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding commit -m "feat(android): MainActivity 无障碍引导卡片+深链intent-filter自动绑定"
```

---

### Task 4: CI 上传 APK 到 COS + smoke

**Files:**
- Modify: `.github/workflows/android-agent-ci.yml`
- Create: `.github/workflows/scripts/smoke/android-onboarding-smoke.sh`

- [ ] **Step 1: 写 smoke（先写，定义完成）**

`android-onboarding-smoke.sh`（可执行，参照 `keyword-collect-mainline-smoke.sh` 的 seed 风格；无 session → 401，带 seeded better-auth session → 200 校验 apk_url+deeplink）：
```bash
#!/usr/bin/env bash
set -uo pipefail
API_PORT="${API_PORT:-3001}"; API_BASE="http://localhost:${API_PORT}"
ok(){ echo "✅ $1"; }; fail(){ echo "❌ $1"; exit 1; }
echo "── Android onboarding smoke ── $API_BASE"

# 1. 无 cookie → 401
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${API_BASE}/api/agent/install-pack/android")
[ "$HTTP" = "401" ] || fail "无 session 期望 401，得 $HTTP"
ok "无 session → 401"

# 2. 带 session（若测试环境提供 seeded TEST_SESSION_COOKIE 则校验 200；否则跳过并说明）
if [ -n "${TEST_SESSION_COOKIE:-}" ]; then
  TMP=$(mktemp)
  HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
    -H "Cookie: ${TEST_SESSION_COOKIE}" "${API_BASE}/api/agent/install-pack/android")
  [ "$HTTP" = "200" ] || { cat "$TMP"; fail "有 session 期望 200，得 $HTTP"; }
  node -e "const d=JSON.parse(require('fs').readFileSync('$TMP','utf8'));
    if(!/^https:\/\/.*myqcloud\.com\/install-pack\/android\/zenithjoy-agent\.apk$/.test(d.apk_url)){console.error('bad apk_url',d.apk_url);process.exit(1)}
    if(!d.deeplink.startsWith('zenithjoy://bind?')){console.error('bad deeplink',d.deeplink);process.exit(1)}" || fail "schema 校验失败"
  rm -f "$TMP"; ok "有 session → 200 + apk_url + deeplink"
else
  echo "⏭️  未提供 TEST_SESSION_COOKIE，跳过 200 校验（CI 会注入）"
fi
echo "✅ android-onboarding smoke PASS"
```

- [ ] **Step 2: 本地跑 smoke（对已起 API）确认 401 分支**

Run: `bash /Users/administrator/worktrees/zenithjoy/line02-android-onboarding/.github/workflows/scripts/smoke/android-onboarding-smoke.sh`
Expected: `✅ 无 session → 401` + 跳过 200（或按环境 PASS）。

- [ ] **Step 3: CI 加 coscmd 上传步骤**

`android-agent-ci.yml`：在 `Build release APK`(L74-75) 之后、`Upload release APK`(L77) 之前插入（working-directory 已是 services/agent-android）：
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

- [ ] **Step 4: 把 smoke 接进 CI**（让 smoke 真在 CI 跑，否则 merge≠跑）

查 `.github/workflows/` 里跑 smoke 的 workflow（如 api-contract-smoke），把 `android-onboarding-smoke.sh` 按其既有「逐个点名」方式加入调用列表（参照 `keyword-collect-mainline-smoke.sh` 是怎么被列进去的）。改 workflow yml 时 commit message 带 `[CONFIG]` 前缀。

- [ ] **Step 5: commit**

```bash
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding add .github/workflows/android-agent-ci.yml .github/workflows/scripts/smoke/android-onboarding-smoke.sh .github/workflows/
git -C /Users/administrator/worktrees/zenithjoy/line02-android-onboarding commit -m "[CONFIG] ci(android): 上传 APK 到 COS + android-onboarding smoke 接线"
```

---

## Self-Review

- **Spec coverage**：后端端点(Task1)/前端下载页+二维码+磁贴(Task2)/安卓无障碍引导+深链绑定(Task3)/CI 上传+smoke(Task4) 全覆盖 spec 四端。错误路径(401/无 license/无障碍关/深链不符)在 Task1、Task3 代码与 spec 错误处理段对齐。
- **JVM 单测坑已规避**：parseBindDeepLink 纯字符串解析不依赖 android.net.Uri；isServiceEnabled 纯函数；Settings 只在 collectServiceEnabled（不进单测）。
- **类型一致**：`AndroidInstallPack {apk_url,deeplink,license_key,version}` 前后端字段一致；`BindParams(license,api)`、`isServiceEnabled(enabledSetting,pkg,serviceClass)` 签名 Task3 内一致。
- **护栏**：register/桌面 manifest/os_type 均零改动；二维码复用 qrcode.react；android 端点 session 鉴权 401。
- **测试注册**：Task4 Step4 显式把 smoke 接进 CI（避免 merge≠跑）；android 单测已在现有 `testDebugUnitTest` job 覆盖。test-registry.yaml 需在收尾补 3 条（后端 android 端点 vitest / 安卓 onboarding 单测 / android-onboarding smoke）——放入收尾 finishing 前。
