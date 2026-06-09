# line04 preflight 自动修复设计

## 目标

Agent 安装在空白 Windows 机器上后，line04 模块所需的两个依赖（微信 4.1.8 + pywinauto）由 Agent 自动安装，无需用户手动操作。

## 改动范围

单文件：`services/agent/modules/line04/preflight.ts`

## 新增函数

### 1. `checkWechatRunning(): CheckOutcome`

用 `tasklist /FI "IMAGENAME eq WeChat.exe"` 检测微信进程是否在跑。

- 进程存在 → `{ ok: true }`
- 进程不存在 → `{ ok: true, fixGuide: "微信未运行，请打开微信并登录后等待 Agent 自动连接" }`

**软检测**：不影响 preflight ok/fail 结果，仅作为状态信息透传给 Dashboard。

### 2. `installWeChat(downloadDir: string): Promise<void>`

1. 从 COS 下载 `WeChatWin_4.1.8.exe` 到 `downloadDir`
2. 执行 `WeChatWin_4.1.8.exe /S`（腾讯自研包静默参数）
3. 等待安装完成（spawn + close 事件）
4. 安装后 taskkill WeChat.exe（静默装完会自动拉起，需关掉等用户手动登录）

### 3. `installPywinauto(pythonPath: string): Promise<void>`

1. 下载 `get-pip.py`（从 `https://bootstrap.pypa.io/get-pip.py`，或预置进 install-pack）
2. `pythonPath get-pip.py --quiet`
3. `pythonPath -m pip install pywinauto --quiet --index-url https://pypi.tuna.tsinghua.edu.cn/simple/`

### 4. `autoRepair(moduleDir: string): Promise<{ wechatFixed: boolean; pywinautoFixed: boolean }>`

在 `runPreflight()` 里，首轮检测有 wechat_version 或 pywinauto 失败时调用：

```
if !wechat.ok → installWeChat() → wechatFixed=true
if !pyw.ok    → installPywinauto(python) → pywinautoFixed=true
```

修复后重跑 `checkWechatVersion()` + `checkPywinauto()`，用新结果覆盖。

## 修复 `getModulePython()`

对齐 `wechat-rpa.ts` 的 `getPythonExeForTest` 逻辑：

```typescript
export function getModulePython(moduleDir: string): string {
  const embedded = path.join(moduleDir, 'python-embedded', 'python.exe');
  if (fs.existsSync(embedded)) return embedded;
  const coreDir = process.env.ZENITHJOY_CORE_DIR;
  if (coreDir) {
    const coreEmbedded = path.join(coreDir, 'python-embedded', 'python.exe');
    if (fs.existsSync(coreEmbedded)) return coreEmbedded;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}
```

## `runPreflight()` 新流程

```
1. checkWechatVersion() + checkPywinauto() + checkMemory()  ← 首轮
2. if wechat 或 pyw 失败 → autoRepair()                     ← 自动修复
3. 重检 wechat + pyw                                         ← 二轮
4. checkWechatRunning()                                      ← 软检测
5. 组装结果返回
```

## 测试策略

**Unit tests（`__tests__/preflight.test.ts` 扩展）：**

- `checkWechatRunning`：mock `execSync`，WeChat.exe 在列表 → ok:true；不在 → ok:true + fixGuide 含"请打开微信"
- `getModulePython`：ZENITHJOY_CORE_DIR 已设且路径存在 → 返回 coreDir 路径
- `autoRepair`：mock `installWeChat` + `installPywinauto`，验证调用时机（只有对应检测失败才触发）
- `installWeChat`：mock spawn，验证参数含 `/S`
- `installPywinauto`：mock spawn，验证参数含 `pypi.tuna.tsinghua.edu.cn`

**不写 E2E**（需要真实 Windows 环境 + 网络下载，CI 无法执行）。

## 不包含

- 微信登录状态检测（需 pywinauto 操作 UI，复杂度高，另立 sprint）
- WeChat 卸载旧版逻辑（4.1.8 安装会覆盖，无需先卸载）
- 离线 wheel 预置（在线 pip 已够，离线方案另立 sprint）
