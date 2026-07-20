# 刀A:overlay pywebview 确定性供给 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pywebview 进打包/安装链(锁版本+失败硬红),overlay preflight 失败自动补装且必上心跳红灯,判据焊进 installpack 闸与 GP-4 golden path。

**Architecture:** 三段:①供给(打包 WHEEL_PKGS/requirements + overlay 自修复 installPywebview)②上报(OverlayHandler 状态 → line04 健康 IPC `overlay` 字段 → module-manager healthReport `line04-overlay` key → 心跳 module_status → 看板列)③闸门(installpack 产物 import 硬断言 + e2e 探针转硬 + GP-4 Step 3k 供给链断言)。

**Tech Stack:** bash(打包/smoke)、TypeScript(agent core+line04 模块,vitest)、React(dashboard)、GitHub Actions。

## Global Constraints

- 所有输出简体中文;commit 前缀 `fix:`(修 bug),动 workflows 的 PR 标题带 `[CONFIG]`
- TDD 铁律:NO PRODUCTION CODE WITHOUT FAILING TEST FIRST;每 task commit-1=红测试 / commit-2=实现绿
- pywebview 版本必须三处同一锁定版(记 `PYWEBVIEW_PIN`,Task 1 Step 1 探明后全文替换,禁止无版本裸装)
- 改 `services/agent/wechat-rpa/` 任何文件必须 rsync 同步 `services/agent/build-modules/line04/wechat-rpa/`(ci-l4-runtime diff -r 硬闸)
- 改 `services/agent/src` → bump `services/agent/package.json` patch 版;改 `modules/line04` → bump `modules/line04/manifest.json` version(1.0.147→1.0.148)
- 新 .test.ts 文件须登记 test-registry.yaml(若 CI 有该闸);不新增散装 smoke 脚本

---

### Task 1: 打包链供给 + 硬红(含 GP-4 断言先红)

**Files:**
- Modify: `services/agent/scripts/build-install-pack.sh`(R2 段,约 :160-205)
- Modify: `services/agent/wechat-rpa/requirements.txt`、`services/agent/build-modules/line04/wechat-rpa/requirements.txt`
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`(Step 3 块后新增 Step 3k)

**Interfaces:**
- Produces: `PYWEBVIEW_PIN`(锁定版本字符串,后续 Task 2/6 复用同字面量)

- [ ] **Step 1: 探明并锁定 pywebview 版本**

```bash
python3 -m pip index versions pywebview 2>/dev/null | head -2
```
取输出的最新稳定版(形如 `pywebview (X.Y.Z)`),下文所有 `<PIN>` 用该字面量替换。

- [ ] **Step 2: 写 GP-4 Step 3k 断言(失败测试——当前必红)**

在 `golden-path-4-smoke.sh` Step 3 的 `ok "Step 3 ✅ ..."` 行之后追加:

```bash
# Step 3k(刀A 2026-07-20):overlay pywebview 供给链四处齐备——框框死3天事故的机器守卫。
# 任何 PR 拆掉任一处(打包预装/依赖声明/客户机自修复/红灯上报接线)本步即红。
BUILD_PACK_SH="services/agent/scripts/build-install-pack.sh"
REQ_TXT="services/agent/wechat-rpa/requirements.txt"
PREFLIGHT_TS="services/agent/modules/line04/preflight.ts"
OVERLAY_TS="services/agent/modules/line04/handlers/overlay.ts"
grep -E 'WHEEL_PKGS=.*pywebview==' "$BUILD_PACK_SH" \
  || fail "Step 3k 打包预装列表 WHEEL_PKGS 缺 pywebview 锁定版(框框断供根因①)" 3
grep -qE '^pywebview==' "$REQ_TXT" \
  || fail "Step 3k requirements.txt 缺 pywebview 锁定版声明" 3
grep -q 'installPywebview' "$PREFLIGHT_TS" \
  || fail "Step 3k preflight.ts 缺 installPywebview 客户机自修复(存量机换core目录即再断)" 3
grep -q 'pywebview_install_failed' "$OVERLAY_TS" \
  || fail "Step 3k overlay.ts 缺补装失败上报(静默降级复辟)" 3
ok "Step 3k ✅ overlay pywebview 供给链四处齐备(预装/声明/自修复/红灯)"
```

- [ ] **Step 3: 本地跑 Step 3k 验证红**

```bash
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | grep "Step 3k"
```
Expected: `FAIL ... WHEEL_PKGS 缺 pywebview`(前两条断言红;后两条在 Task 2/3 转绿)。

- [ ] **Step 4: commit-1(红)**

```bash
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh
git commit -m "test: GP-4 Step 3k overlay pywebview 供给链断言(先红)"
```

- [ ] **Step 5: 改打包脚本——WHEEL_PKGS 加锁定版 + 失败硬红 + 重试**

`build-install-pack.sh` 中 `WHEEL_PKGS="pywinauto pywin32 comtypes six requests"` 改为:

```bash
WHEEL_PKGS="pywinauto pywin32 comtypes six requests pywebview==<PIN>"
```

`if install_embedded_pkgs; then ... else echo WARN ... fi` 块整体替换为(硬红+3次退避重试,铁律 9202c14e):

```bash
INSTALL_OK=0
for attempt in 1 2 3; do
  if install_embedded_pkgs; then INSTALL_OK=1; break; fi
  echo "[build] pip 预装第 ${attempt} 次失败,$((attempt*10))s 后重试…"
  sleep $((attempt*10))
done
if [ "$INSTALL_OK" = "1" ]; then
  echo "[build] python-embedded site-packages 已装 ${WHEEL_PKGS}"
else
  echo "[build] FAIL: python 依赖预装失败(3次重试后)——禁止出无依赖的包(刀A硬红,铁律9202c14e)" >&2
  exit 1
fi
```

其后的验证段(`if [ -d "$SITE_PKGS/pywinauto" ]` WARN 块)替换为硬断言并加 webview:

```bash
for must_pkg in pywinauto webview; do
  if [ -d "$SITE_PKGS/$must_pkg" ]; then
    echo "[build] verified: site-packages/$must_pkg/ 存在"
  else
    echo "[build] FAIL: site-packages/$must_pkg/ 缺失——产物残缺禁止出包(刀A硬红)" >&2
    exit 1
  fi
done
```

- [ ] **Step 6: 两份 requirements.txt 追加(win32 限定,与 pywinauto 同风格)**

两份文件末尾各加:

```
pywebview==<PIN>; sys_platform == "win32"
```

- [ ] **Step 7: 验证——smoke 前两条转绿 + 打包脚本语法**

```bash
bash -n services/agent/scripts/build-install-pack.sh && echo SYNTAX-OK
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | grep "Step 3k"
diff services/agent/wechat-rpa/requirements.txt services/agent/build-modules/line04/wechat-rpa/requirements.txt && echo REQ-SYNCED
```
Expected: SYNTAX-OK;Step 3k 仍红但报错落到第三条(installPywebview);REQ-SYNCED。

- [ ] **Step 8: commit-2(供给部分绿)**

```bash
git add services/agent/scripts/build-install-pack.sh services/agent/wechat-rpa/requirements.txt services/agent/build-modules/line04/wechat-rpa/requirements.txt
git commit -m "fix(agent): pywebview==<PIN> 进打包预装链,pip 失败硬红+3次重试(刀A供给)"
```

---

### Task 2: 客户机自修复 installPywebview(preflight.ts)

**Files:**
- Modify: `services/agent/modules/line04/preflight.ts`(installPywinauto 块后,约 :689-703)
- Test: `services/agent/modules/line04/__tests__/preflight.test.ts`(找同名既有文件,跟随 installPywinauto 既有测试模式;不存在则新建并登记 test-registry)

**Interfaces:**
- Produces: `export async function installPywebview(pythonPath: string, downloadDir: string): Promise<{ ok: boolean; reason?: string }>`;`export const PYPI_OFFICIAL_URL`;挂入 `_repairFuncs.installPywebview`(供 overlay.ts 与测试 spy)

- [ ] **Step 1: 写失败测试**

在 preflight 测试文件中(跟随该文件对 spawnSync/downloadFile 的既有 mock 模式):

```typescript
describe('installPywebview', () => {
  it('清华源失败回退官方源,两源都失败返回 ok:false reason:pywebview_install_failed', async () => {
    // mock spawnSync: pip install 调用一律返回 status:1(跟随文件内既有 spawnSync mock 手法)
    const r = await installPywebview('C:\\py\\python.exe', tmpDir);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pywebview_install_failed');
  });
  it('清华源成功即返回 ok:true 且不再调官方源', async () => {
    // mock spawnSync: 首个 pip install 返回 status:0
    const r = await installPywebview('C:\\py\\python.exe', tmpDir);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试验证红**

```bash
cd services/agent && npx vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -5
```
Expected: FAIL `installPywebview is not defined`/导出缺失。

- [ ] **Step 3: commit-1(红)**

```bash
git add services/agent/modules/line04/__tests__/preflight.test.ts
git commit -m "test(line04): installPywebview 双源回退+失败冒泡(先红)"
```

- [ ] **Step 4: 实现(installPywinauto 块正下方)**

```typescript
export const PYPI_OFFICIAL_URL = 'https://pypi.org/simple/';
export const PYWEBVIEW_PIN = 'pywebview==<PIN>'; // 与打包链 WHEEL_PKGS 同一锁定版

// 刀A(2026-07-20 框框断供根治):客户机侧 pywebview 自修复。
// 与 installPywinauto 的区别:①锁版本 ②清华→官方双源回退 ③失败必冒泡(禁静默,混沌P0-2)。
export async function installPywebview(
  pythonPath: string,
  downloadDir: string,
): Promise<{ ok: boolean; reason?: string }> {
  const getPipScript = path.join(downloadDir, 'get-pip.py');
  try {
    await downloadFile(GET_PIP_URL, getPipScript);
    spawnSync(pythonPath, [getPipScript, '--quiet'], { windowsHide: true, timeout: 60_000 });
  } catch {
    // get-pip 拉不下来仍尝试 pip(可能已 bootstrap 过);真失败由下方安装结果冒泡
  }
  for (const indexUrl of [PIP_INDEX_URL, PYPI_OFFICIAL_URL]) {
    const r = spawnSync(
      pythonPath,
      ['-m', 'pip', 'install', PYWEBVIEW_PIN, '--quiet', '--index-url', indexUrl],
      { windowsHide: true, timeout: 180_000 },
    );
    if (r.status === 0) return { ok: true };
  }
  return { ok: false, reason: 'pywebview_install_failed' };
}
```

并把 `_repairFuncs` 扩为:

```typescript
export const _repairFuncs = {
  installWeChat,
  installPywinauto,
  installPywebview,
  lockWechatUpdate,
};
```

- [ ] **Step 5: 跑测试验证绿 + 全量不破**

```bash
cd services/agent && npx vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -3
npx vitest run 2>&1 | tail -3
```
Expected: PASS;全量无新红。

- [ ] **Step 6: commit-2(绿)**

```bash
git add services/agent/modules/line04/preflight.ts
git commit -m "fix(line04): installPywebview 客机自修复,锁版本+双源回退+失败冒泡"
```

---

### Task 3: overlay.ts 自修复接线 + 状态追踪 + diag 成功态覆写

**Files:**
- Modify: `services/agent/modules/line04/handlers/overlay.ts`(start() :110-139、writeDiag 语义)
- Test: `services/agent/modules/line04/__tests__/overlay-handler.test.ts`(既有文件,跟随其 mock 模式)

**Interfaces:**
- Consumes: Task 2 的 `_repairFuncs.installPywebview`
- Produces: `OverlayHandler.getStatus(): { ok: boolean; reason?: string }`(Task 4 上报用)

- [ ] **Step 1: 写失败测试(三条)**

```typescript
describe('刀A 供给自愈+红灯', () => {
  it('preflight 报 pywebview_missing → 自动补装后重试,补装失败 → getStatus 红且 reason=pywebview_install_failed', async () => {
    // mock _runPreflight 恒 {ok:false, reason:'pywebview_missing'},mock installPywebview 返回 {ok:false, reason:'pywebview_install_failed'}
    const r = await handler.start();
    expect(r.spawned).toBe(false);
    expect(handler.getStatus()).toEqual({ ok: false, reason: 'pywebview_install_failed' });
  });
  it('补装成功且复检通过 → 正常 spawn 且 getStatus ok:true', async () => {
    // mock _runPreflight 第一次 fail(pywebview_missing) 第二次 ok,installPywebview 返回 {ok:true}
    const r = await handler.start();
    expect(r.spawned).toBe(true);
    expect(handler.getStatus().ok).toBe(true);
  });
  it('start 成功路径也覆写 diag(旧失败态不残留)', async () => {
    // 先造一份 last_error 非空的旧 diag 文件,start 成功后读回断言 attach_state='spawned' 且 last_error=""
  });
});
```

- [ ] **Step 2: 跑红** `npx vitest run modules/line04/__tests__/overlay-handler.test.ts` → FAIL(getStatus 不存在)。

- [ ] **Step 3: commit-1(红)** `git commit -m "test(line04): overlay 自动补装+状态红灯+diag覆写(先红)"`

- [ ] **Step 4: 实现**

OverlayHandler 增加字段与方法:

```typescript
private _lastStatus: { ok: boolean; reason?: string } = { ok: false, reason: 'not_started' };
getStatus(): { ok: boolean; reason?: string } { return { ...this._lastStatus }; }
```

start() 的 preflight 失败分支改为(自修复一次+失败冒泡):

```typescript
let preflight = await this._runPreflight();
if (!preflight.ok && preflight.reason === 'pywebview_missing') {
  // 刀A:依赖缺失先自修复再判死(覆盖 core 换目录场景,混沌P0-1)
  const repair = await preflightRepair.installPywebview(
    getPythonExe(), path.join(os.tmpdir(), 'zenithjoy-setup'),
  );
  preflight = repair.ok ? await this._runPreflight()
    : { ok: false, reason: 'pywebview_install_failed' };
}
if (!preflight.ok) {
  const reason = preflight.reason ?? 'preflight_failed';
  this._lastStatus = { ok: false, reason };
  writeDiag(this.stateDir, makeDiag(this.stateDir, { lastError: reason, attachState: 'preflight_failed' }));
  return { spawned: false, reason };
}
```

spawn 成功后(`this._spawnOverlay();` 之后)加:

```typescript
this._lastStatus = { ok: true };
// 刀A:成功态无条件覆写 diag,根除旧失败文件误导排查(混沌P2-7)
writeDiag(this.stateDir, makeDiag(this.stateDir, { attachState: 'spawned', overlayPid: this._proc?.pid ?? null }));
```

顶部 import(经间接层便于测试 mock,命名跟随文件内既有约定):

```typescript
import { _repairFuncs as preflightRepair } from '../preflight';
import * as os from 'os';
```

同时把 `mkdir(os.tmpdir(),'zenithjoy-setup')` 的目录确保放进 installPywebview 内部已有(Task 2 用 downloadDir 前 mkdirSync——若无则在此补 `fs.mkdirSync(dir,{recursive:true})`)。

- [ ] **Step 5: 跑绿 + 全量** 同 Task 2 Step 5 模式。Expected: 三条 PASS,全量无新红;GP-4 Step 3k 第 3/4 条断言转绿:

```bash
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | grep "Step 3k"
```
Expected: `Step 3k ✅`。

- [ ] **Step 6: commit-2(绿)** `git commit -m "fix(line04): overlay 依赖缺失自动补装+失败冒泡+diag成功态覆写"`

---

### Task 4: 红灯上报接线(module 健康 IPC → 心跳 module_status)

**Files:**
- Modify: `services/agent/modules/line04/handlers/wechat-rpa.ts`(buildHealthStatusMessage)
- Modify: `services/agent/modules/line04/index.ts`(reportHealthOnce :43-46)
- Modify: `services/agent/src/module-manager.ts`(captureModuleHealth :694-710、ModuleHealth 类型)
- Test: `services/agent/src/__tests__/module-manager.test.ts` 与 line04 既有健康测试文件(各随既有模式)

**Interfaces:**
- Consumes: Task 3 `getOverlayHandler(...).getStatus()`
- Produces: 心跳 `module_status['line04-overlay'] = { ok, reason }`(服务端/看板即取此 key)

- [ ] **Step 1: 写失败测试(两端各一)**

module-manager 侧:

```typescript
it('健康消息带 overlay 字段 → statusReport 出现 line04-overlay key', () => {
  // 调 captureModuleHealth('line04-wechat-cs', { type:'status', ok:true, overlay:{ ok:false, reason:'pywebview_install_failed' } })
  const report = mm.getModuleStatusReport();
  expect(report['line04-overlay']).toEqual({ ok: false, reason: 'pywebview_install_failed' });
});
```

line04 侧(健康消息构造):

```typescript
it('buildHealthStatusMessage 透传 overlay 状态', () => {
  const msg = buildHealthStatusMessage(health, { ok: false, reason: 'pywebview_missing' });
  expect(msg.overlay).toEqual({ ok: false, reason: 'pywebview_missing' });
});
```

- [ ] **Step 2: 跑红** → FAIL。 **Step 3: commit-1(红)** `git commit -m "test(agent): overlay 红灯经健康IPC入心跳 module_status(先红)"`

- [ ] **Step 4: 实现**

`wechat-rpa.ts` buildHealthStatusMessage 加第二参数与字段:

```typescript
export function buildHealthStatusMessage(
  h: ListenerHealth,
  overlay?: { ok: boolean; reason?: string },
): { type: 'status'; ok: boolean; reason?: string; listener_alive: boolean;
     found_window?: boolean; last_delivery_ts?: number;
     overlay?: { ok: boolean; reason?: string } } {
  return { type: 'status', ok: h.ok, reason: h.reason, listener_alive: h.listener_alive,
           found_window: h.found_window, last_delivery_ts: h.last_delivery_ts, overlay };
}
```

`index.ts` reportHealthOnce:

```typescript
export function reportHealthOnce(send: Send): void {
  const health = collectListenerHealth({ listenerAlive: isListenerAlive() });
  const overlay = process.platform === 'win32'
    ? getOverlayHandler(/* 复用 handleConfig 相同 stateDir 求值 */).getStatus()
    : undefined;
  send(buildHealthStatusMessage(health, overlay));
}
```

(getOverlayHandler 是单例工厂——handleConfig 已创建实例;reportHealthOnce 里用同一 stateDir 表达式取同一实例,提取 stateDir 求值为模块内小函数避免重复。)

`module-manager.ts` captureModuleHealth 消费(healthReport.set 之后):

```typescript
const overlay = (m as { overlay?: { ok?: boolean; reason?: string } }).overlay;
if (overlay && typeof overlay.ok === 'boolean') {
  // 刀A:overlay 独立 key 上红灯——服务端 normalizeModuleStatus 只收 {ok,reason},形状即终态
  this.healthReport.set(`${lineId.startsWith('line04') ? 'line04-overlay' : lineId + '-overlay'}`,
    { ok: overlay.ok, reason: overlay.reason });
}
```

- [ ] **Step 5: 跑绿+全量+编译** `npx tsc --noEmit -p services/agent`(或仓库既有 build 命令)+ vitest 全量。
- [ ] **Step 6: commit-2(绿)** `git commit -m "fix(agent): overlay 状态并入心跳 module_status(line04-overlay key)"`

---

### Task 5: 看板红灯列(dashboard)

**Files:**
- Modify: `apps/dashboard/src/pages/ModuleHealthPage.tsx`(:21-26 LINES)

- [ ] **Step 1: LINES 加列**

```typescript
const LINES = [
  { key: 'line01-publish', label: 'Line01 智能发布' },
  { key: 'line02-lead-gen', label: 'Line02 智能获客' },
  { key: 'line04-wechat-cs', label: 'Line04 微信AI客服' },
  { key: 'line04-overlay', label: 'Line04 框框浮窗' },
  { key: 'line05-video', label: 'Line05 视频剪辑' },
] as const;
```

- [ ] **Step 2: 若该页有既有测试则补一行断言列头渲染;无则跳过(动态 StatusCell 已通用)。构建验证:**

```bash
cd apps/dashboard && npx tsc --noEmit 2>&1 | tail -3
```

- [ ] **Step 3: commit** `git commit -m "fix(dashboard): 模块健康看板加 line04-overlay 框框红灯列"`

---

### Task 6: CI 硬闸(installpack 产物断言 + e2e 探针转硬)

**Files:**
- Modify: `.github/workflows/agent-installpack.yml`(Dryrun verify 步,:159-173)
- Modify: `.github/workflows/wechat-cs-e2e.yml`(:195-210)

- [ ] **Step 1: installpack 产物 import webview 硬断言**

Dryrun verify 步中 `dryrun-print-version OK` 行之后、`Remove-Item` 之前插入:

```powershell
& "$agentDir\python-embedded\python.exe" -c "import webview; print('webview-import-ok')"
if ($LASTEXITCODE -ne 0) { throw "packaged python-embedded cannot import webview — overlay supply broken (knife-A gate)" }
Write-Host "[verify] pywebview import OK"
```

- [ ] **Step 2: e2e 探针转硬**

wechat-cs-e2e.yml 探针 run 块替换为(去 `|| true` 与 `|| echo` 兜底;rog 走清华源):

```yaml
        run: |
          mkdir -p "$ZJ_STATE_DIR"
          python -m pip install --quiet pywebview -i https://pypi.tuna.tsinghua.edu.cn/simple
          python overlay/overlay_window.py --probe
          echo "BEHAVIOR-1 PASS: pywebview 建窗探针 exit_code=0"
```

同步把该步上方注释里"非致命"字样删掉。

- [ ] **Step 3: 语法验证** `npx yaml-lint`(或 `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/agent-installpack.yml')); yaml.safe_load(open('.github/workflows/wechat-cs-e2e.yml'))"`) → OK。
- [ ] **Step 4: commit** `git commit -m "fix(ci): installpack 产物 import webview 硬断言 + e2e pywebview 探针去纸糊闸"`

---

### Task 7: 版本合规 + 镜像同步 + 全量回归

**Files:**
- Modify: `services/agent/package.json`(patch bump,改了 src/module-manager.ts+heartbeat 相关)
- Modify: `services/agent/modules/line04/manifest.json`(version 1.0.147→1.0.148)
- Verify: build-modules 镜像、test-registry、smoke-baseline

- [ ] **Step 1: bump 两处版本**(patch;manifest.json 的 `"version"` 字段 +1)
- [ ] **Step 2: 镜像同步核对**

```bash
rsync -a --delete --exclude tests services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --dry-run -v | head
diff -r services/agent/wechat-rpa services/agent/build-modules/line04/wechat-rpa --exclude tests && echo MIRROR-OK
```
有差异则执行不带 --dry-run 的 rsync。Expected 最终: MIRROR-OK。

- [ ] **Step 3: 新测试文件登记**(若 Task 2 新建了 preflight.test.ts):检查 `test-registry.yaml` 存在性并按既有条目格式追加;测试文件全为既有文件改动则跳过。
- [ ] **Step 4: 全量回归**

```bash
cd services/agent && npx vitest run 2>&1 | tail -5
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | tail -5
```
Expected: 全绿。

- [ ] **Step 5: commit** `git commit -m "fix(agent): 刀A版本bump+build-modules镜像同步"`

---

### Task 8: Proven-to-fire 变异测试(三发,留证据)

**Files:**
- Create: `sprints/07201020-overlay-pywebview-supply/evidence/proven-to-fire.md`

- [ ] **Step 1: 变异①供给闸**——临时把 WHEEL_PKGS 里 `pywebview==<PIN>` 删掉 → `bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh` → 断言 Step 3k 红,输出前 3 行存证 → `git checkout -- services/agent/scripts/build-install-pack.sh` 还原。
- [ ] **Step 2: 变异②红灯上报**——临时注释 overlay.ts 中 `this._lastStatus = { ok: false, reason };` 行 → `npx vitest run modules/line04/__tests__/overlay-handler.test.ts` → 断言红,存证 → 还原。
- [ ] **Step 3: 变异③依赖声明**——临时删 requirements.txt 的 pywebview 行 → smoke Step 3k 红,存证 → 还原。
- [ ] **Step 4: 证据落盘 + commit**

```bash
git add sprints/07201020-overlay-pywebview-supply/evidence/proven-to-fire.md
git commit -m "test: 刀A三发变异测试证据(供给闸/红灯/声明均 proven-to-fire)"
```

- [ ] **Step 5: 还原核对** `git status --short` 仅剩预期文件;三处变异全部还原。

---

## 完成后(不在本计划内,由接力链执行)

finishing(push + PR,标题 `[CONFIG] fix(line04): overlay pywebview 确定性供给+消灭静默降级+GP-4 判据(刀A)`)→ engine-ship → engine-pr-watchdog。merge 后真机轻量 evaluator:等 rog OTA 到新版,断言心跳 `module_status['line04-overlay']` 出现且看板列变色(锚定断言真跑,决策 145014a4 修层纪律)。
