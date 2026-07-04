# Design: desktop-lease-broker 日志落盘补进真实部署的 Line04 模块文件

## 背景

PR#1096 把日志落盘代码（`appendListenChatLog`）加进了 `services/agent/src/handlers/wechat-rpa.ts`——这个文件文件头明确标注 `@deprecated`，"Core v2.0.0 不再直接 import 本文件"。真正被 `build-line-module.sh` 编译进客户机安装包、实际运行 `startWechatListener` 的文件是独立维护的 `services/agent/modules/line04/handlers/wechat-rpa.ts`（sprint 06081700 模块化拆包时从原文件复制、此后独立分叉）。日志落盘代码进了没人在跑的文件，真实客户机永远不会产生这个日志。

同时发现 CI 里已有"line04 三个版本面一致（modules / build-modules / 中台心跳）"闸门，两个前序 PR 都没有触发 line04 模块版本 bump，即使改对文件，不走完整的版本同步流程，客户机也不会重新下载。

## 架构

```
真实运行路径（客户机）：
  core (zenithjoy-agent.exe) --fork--> modules/line04-wechat-cs-x.x.x/index.js
                                          --require--> handlers/wechat-rpa.js（编译自 modules/line04/handlers/wechat-rpa.ts）
                                          --spawn--> wechat-rpa/listen_chat.py（编译自共享 Python 源，已在 PR#1085 修复，不受影响）

本次要改的文件：services/agent/modules/line04/handlers/wechat-rpa.ts
  → startWechatListener() 的 child.stderr.on('data', ...) 追加落盘调用
  → 编译产物 services/agent/build-modules/line04/handlers/wechat-rpa.js 需要重新生成并提交
  → 三个版本面必须一致才能让客户机真的重新下载：
      services/agent/modules/line04/manifest.json
      services/agent/build-modules/line04/manifest.json
      apps/api/src/services/walking-skeleton.service.ts HEARTBEAT_MODULES['line04-wechat-cs'].required_version
```

**不动的部分**（已确认架构正确）：
- `services/agent/src/index.ts` 里的 `registerLeaseBrokerRoutes(server)`（core 级单例，正确）
- `services/agent/wechat-rpa/listen_chat.py` 的 `reply_in_chat_with_lease`（全局共享 Python 源，正确）
- `services/agent/src/handlers/wechat-rpa.ts` 里 PR#1096 加的 `appendListenChatLog`（保留，虽然是死代码但不删——删除是另一个决定，本次只管补上真正生效的那一份，不做无关清理）

## 组件：模块内自包含的日志落盘函数

不能从 `modules/line04/handlers/wechat-rpa.ts` import 核心的 `config-loader.ts`（`build-line-module.sh` 只编译 `modules/line04/*.ts` + `modules/line04/handlers/*.ts`，没有到 core src 的模块解析路径）。按该文件已有的"自包含路径解析"约定（如 `getModuleRoot()`），内联一个最小实现：

```ts
import os from 'node:os';

const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

function getAgentLogDir(): string {
  const base = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'zenithjoy-agent')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'zenithjoy-agent');
  return path.join(base, 'logs');
}

export function appendListenChatLog(chunk: string, opts?: { maxBytes?: number }): void {
  try {
    const logDir = getAgentLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    const maxBytes = opts?.maxBytes ?? DEFAULT_LOG_MAX_BYTES;

    if (fs.existsSync(logFile) && fs.statSync(logFile).size > maxBytes) {
      fs.renameSync(logFile, path.join(logDir, 'listen-chat.log.old'));
    }
    fs.appendFileSync(logFile, chunk);
  } catch {
    // 磁盘满/权限问题绝不能让 listen_chat 崩溃。
  }
}
```

日志目录用**同一套 `AppData/Roaming/zenithjoy-agent/logs`** 惯例（跟 core 那份保持一致的落盘位置，方便排障时只用记一个路径），但实现上是模块自己独立的一份代码，不产生跨模块依赖。

在 `startWechatListener` 现有的：
```ts
    child.stderr!.on('data', (d: Buffer) => {
      console.warn('[listen_chat stderr]', d.toString().trim());
    });
```
追加调用（跟 core 那份改法完全对称）：
```ts
    child.stderr!.on('data', (d: Buffer) => {
      const text = d.toString();
      console.warn('[listen_chat stderr]', text.trim());
      appendListenChatLog(text);
    });
```

## 版本 bump 三面同步

1. `services/agent/modules/line04/manifest.json`：`1.0.106` → `1.0.107`
2. `services/agent/build-modules/line04/manifest.json`：同步改 `1.0.107`（跑 `build-line-module.sh line04` 会自动从源 manifest 拷贝，但为了 CI 闸门在编译前也能过，手动先改一致）
3. `apps/api/src/services/walking-skeleton.service.ts` 里 `HEARTBEAT_MODULES` 对 `line04-wechat-cs` 的 `required_version` 同步改成 `1.0.107`

## 重新编译

跑：
```bash
cd services/agent && bash scripts/build-line-module.sh line04
```
确认 `build-modules/line04/handlers/wechat-rpa.js` 里出现 `appendListenChatLog`，且 `build-modules/line04/manifest.json` 版本号跟源一致。提交编译产物（这是 git-tracked 的构建产物，仓库现有约定就是手动提交编译后的 build-modules，不是 CI 自动生成后合并）。

## 测试策略

Unit test（Vitest，模块级测试目录 `services/agent/modules/line04/__tests__/`，已有先例如 `wechat-rpa-listener-stdout.test.ts`）：

1. `appendListenChatLog` 写入内容后文件包含该内容（复用 PR#1096 已验证过的测试模式，改成测这个模块文件里的版本）
2. mock `fs.appendFileSync` 抛异常 → 不上抛

不需要重复 PR#1096 里已经测过的轮转逻辑细节测试（两份实现逻辑完全一致，核心逻辑已经被证明工作正常，这里只需要证明"这份模块里的函数确实存在且被 stderr 回调调用"，防止未来又双叒改错文件）。

关键防回归测试：读源码文本断言 `startWechatListener` 函数体内含 `appendListenChatLog(` 调用（跟 PR#1085 里"run_real_listen 必须调用 reply_in_chat_with_lease"用的是完全一样的 ARTIFACT 型防回归手法）。

**已有的 CI 闸门会覆盖"三面版本一致"和"build-modules 与源同步"**，不需要为这两条新写测试，这次改动跑过这两条闸门本身就是验证。

## 不做的事

- 不删除 `services/agent/src/handlers/wechat-rpa.ts` 里已经写的（死代码）`appendListenChatLog`——那是另一个"清理 deprecated 文件"的决定，不在本次 bug 修复范围
- 不排查 xian-rog 上 agent 为什么落后到 1.0.102（记录为待办，交给用户后续处理，可能是另一条独立的 OTA 触发链路问题）
- 不重新设计 DesktopLeaseBroker 架构或改动已确认正确的 Python 侧/core 侧代码
