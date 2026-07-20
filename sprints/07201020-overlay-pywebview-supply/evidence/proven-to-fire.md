# 刀A 三发 proven-to-fire 变异测试证据

Task 8。三发变异测试用于证明"供给闸/红灯/依赖声明"三处守卫都是真闸——破坏对应代码后
必须真的看到红，不是纸糊守卫；还原后必须复验绿。

流程统一为：临时破坏 → 跑对应守卫命令 → 截取红输出 → `git checkout --` 还原 → 复跑确认绿。

---

## 变异①：打包预装列表 WHEEL_PKGS 缺 pywebview 锁定版

**破坏点**：`services/agent/scripts/build-install-pack.sh` 第 169 行

```diff
- WHEEL_PKGS="pywinauto pywin32 comtypes six requests pywebview==6.2.1"
+ WHEEL_PKGS="pywinauto pywin32 comtypes six requests"
```

**破坏命令**：删除该行内 `pywebview==6.2.1` 片段（等价于把 pywebview 从打包预装清单里拿掉）。

**跑的守卫命令**：
```bash
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```

**红输出摘录**（退出码 3）：
```
✅ Step 3 ✅ Agent 后台静默监听部署包存在（overlay_window.py 含 switch_customer + events 消费）
❌ Step 3k 打包预装列表 WHEEL_PKGS 缺 pywebview 锁定版（框框断供根因①）
```

**还原命令**：
```bash
git checkout -- services/agent/scripts/build-install-pack.sh
```

**还原后复验**：`bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh` 退出码 0，
`✅ Step 3k ✅ overlay pywebview 供给链四处齐备（预装/声明/自修复/红灯）`。

**结论**：Step 3k 对 WHEEL_PKGS 的断言 **proven-to-fire**。

---

## 变异②：overlay.ts preflight 失败分支不再写 `_lastStatus`（红灯上报）

**破坏点**：`services/agent/modules/line04/handlers/overlay.ts` `start()` 内
`if (!preflight.ok)` 分支，第 144 行。

```diff
     if (!preflight.ok) {
       const reason = preflight.reason ?? 'preflight_failed';
-      this._lastStatus = { ok: false, reason };
+      // MUTATION-TEST-TEMP: this._lastStatus = { ok: false, reason };
       const diag = makeDiag(this.stateDir, {
```

**跑的守卫命令**：
```bash
cd services/agent && npx vitest run modules/line04/__tests__/overlay-handler.test.ts
```

**红输出摘录**（1 failed / 16 total，退出码 1）：
```
 ❯ modules/line04/__tests__/overlay-handler.test.ts (16 tests | 1 failed) 43ms
   × 刀A 供给自愈+红灯 > preflight 报 pywebview_missing → 自动补装后重试,补装失败 → getStatus 红且 reason=pywebview_install_failed 4ms
     → expected { ok: false, reason: 'not_started' } to deeply equal { ok: false, …(1) }

 FAIL  modules/line04/__tests__/overlay-handler.test.ts > 刀A 供给自愈+红灯 > preflight 报 pywebview_missing → 自动补装后重试,补装失败 → getStatus 红且 reason=pywebview_install_failed
AssertionError: expected { ok: false, reason: 'not_started' } to deeply equal { ok: false, …(1) }

- Expected
+ Received
  {
    "ok": false,
-   "reason": "pywebview_install_failed",
+   "reason": "not_started",
  }

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

**还原命令**：
```bash
git checkout -- services/agent/modules/line04/handlers/overlay.ts
```

**还原后复验**：`npx vitest run modules/line04/__tests__/overlay-handler.test.ts`
`Test Files  1 passed (1)` / `Tests  16 passed (16)`。

**结论**：红灯上报（preflight 失败态同步写 `_lastStatus`，供 Task 4 上报）**proven-to-fire**——
一旦静默降级复辟（漏写 `_lastStatus`），单测立刻抓到。

---

## 变异③：requirements.txt 删 pywebview 依赖声明

**破坏点**：`services/agent/wechat-rpa/requirements.txt` 第 8 行

```diff
  requests>=2.31.0
- pywebview==6.2.1; sys_platform == "win32"
```

**跑的守卫命令**：
```bash
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```

**红输出摘录**（退出码 3）：
```
✅ Step 3 ✅ Agent 后台静默监听部署包存在（overlay_window.py 含 switch_customer + events 消费）
❌ Step 3k requirements.txt 缺 pywebview 锁定版声明
```

**还原命令**：
```bash
git checkout -- services/agent/wechat-rpa/requirements.txt
```

**还原后复验**：`bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh` 退出码 0，
`✅ Step 3k ✅ overlay pywebview 供给链四处齐备（预装/声明/自修复/红灯）`，
16 步 golden path smoke 服务端段全通。

**结论**：requirements.txt 依赖声明这处闸 **proven-to-fire**。
（注：build-modules 镜像那份 `services/agent/build-modules/line04/wechat-rpa/requirements.txt`
未动，本发只针对 Step 3k 断言的 `services/agent/wechat-rpa/requirements.txt` 源文件。）

---

## 总结

| 变异 | 破坏对象 | 守卫命令 | 红结果 | 还原后 |
|---|---|---|---|---|
| ① 供给闸 | build-install-pack.sh WHEEL_PKGS | golden-path-4-smoke.sh | Step 3k FAIL（退出码 3） | 绿（退出码 0） |
| ② 红灯上报 | overlay.ts `_lastStatus` 写入 | vitest overlay-handler.test.ts | 1 failed / 16（退出码 1） | 16 passed（退出码 0） |
| ③ 依赖声明 | requirements.txt pywebview 行 | golden-path-4-smoke.sh | Step 3k FAIL（退出码 3） | 绿（退出码 0） |

三发变异全部真实触发红、还原后真实复验绿，`git status --short` 三处修改均已用
`git checkout --` 精确还原，无残留改动。三处守卫均 proven-to-fire，非纸糊闸。
