# Agent wechat-rpa 接入真实 pywinauto 脚本

**日期**: 2026-06-03  
**分支**: cp-0603121857-agent-wechat-rpa-real  
**Journey**: Path 4 客户私域 AI 接管

## 背景

PR #615 已在 xian-pc 微信 4.0 用 pywinauto 全链路验证通过（读未读会话 → DeepSeek 生成回复 → 自动发出）。但 `wechat-rpa.ts` 的 `resolveScript()` 仍指向 dryrun 桩，内部运营团队无法真正使用。

## 改动范围

**3 个文件，均在 `services/agent/src/`：**

### handlers/wechat-rpa.ts

**1. `resolveScript()` 按 task.type 分发真实脚本**

```typescript
function resolveScript(task: WechatRpaTask): string {
  if (task.pythonStub) return task.pythonStub;
  const rpaDir = path.resolve(__dirname, '../../wechat-rpa');
  switch (task.type) {
    case 'wechat_private_chat_send': return path.join(rpaDir, 'send_chat.py');
    case 'wechat_qr_bind':           return path.join(rpaDir, 'qr_bind.py');
    case 'wechat_moments_send':      return path.join(rpaDir, 'send_moment.py');
    default:                         return path.join(rpaDir, 'send_chat.py');
  }
}
```

**2. `handleWechatRpa()` spawn 加 `REAL_PUBLISH=1` 环境变量**

`send_chat.py` / `send_moment.py` 用 `REAL_PUBLISH` 控制是否真发。spawn 时加：
```typescript
const py = spawn('python3', [script], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REAL_PUBLISH: '1' },
});
```

**3. 新增 `startWechatListener(apiBase: string)` 导出函数**

```typescript
export function startWechatListener(apiBase: string): void {
  if (process.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  const script = path.resolve(__dirname, '../../wechat-rpa/listen_chat.py');
  spawn('python3', [script, '--middleware-url', apiBase], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  console.log('[wechat-rpa] listen_chat.py 已自启（middleware-url:', apiBase, '）');
}
```

### index.ts

在 `startWs1HeartbeatLoop(cfg)` 调用后加一行：

```typescript
startWechatListener(cfg.apiBase);
```

并在顶部 import 中加 `startWechatListener`。

## 数据流

```
Agent 启动（Windows）
  └→ startWechatListener(apiBase)
       └→ spawn listen_chat.py --middleware-url <apiBase> [detached]
            └→ 轮询微信未读消息
                 └→ POST /api/wechat/draft-generate?mode=auto
                      └→ DeepSeek 生成回复
                           └→ pywinauto 自动发出

中台下发任务（heartbeat）
  └→ task.platform = wechat_private_chat_send
       └→ handleWechatRpa({ type, payload })
            └→ resolveScript() → send_chat.py
                 └→ spawn python3 send_chat.py（stdin JSON + REAL_PUBLISH=1）
```

## 非 Windows 行为

- `startWechatListener`: log 跳过，不 spawn，不报错
- `resolveScript`: 路径仍返回真实脚本路径（spawn 时若 python3 不存在会报错，但 CI Linux runner 不会执行到 wechat 任务）

## 测试策略

| 层级 | 测试内容 | 运行环境 |
|------|----------|----------|
| unit | `resolveScript()` 各 type 返回正确路径 | CI Linux |
| unit | `startWechatListener()` 非 Windows → log skip，不 spawn | CI Linux |
| unit | `handleWechatRpa` dryrun（pythonStub 注入）退出码 0 | CI Linux |
| manual | Windows xian-rog：Agent 启动日志出现 `listen_chat.py 已自启` | 内部机 |

## 版本

Agent 版本从 `1.1.76` → `1.1.77`（需 bump + 重打包）
