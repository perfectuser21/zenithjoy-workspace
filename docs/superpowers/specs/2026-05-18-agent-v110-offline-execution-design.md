# Agent v1.1.0 — 离线执行架构设计

**日期**: 2026-05-18  
**分支**: cp-0518115032-agent-v110-offline-execution  
**版本**: services/agent 1.0.1 → 1.1.0

---

## 问题诊断

| Bug | 现象 | 根因 |
|---|---|---|
| BGM hang | job 卡 processing/65%，输出目录为空 | BGM fetch 无 timeout；PiAPI 需 120s 但 nginx 通用块 30s → TCP 半开时 Agent 永远等待 |
| stale job | Agent 崩溃后 job 永远卡 processing | 轮询只查 `status=pending`，已置 processing 的 job 永远不被重拾 |
| transcribe/design 超时 | AI 步骤偶发 504 | 走 nginx `/api/` 通用块（30s），而 OpenRouter 调用可超 30s |
| ffprobe blocking | 大文件（6.85GB）可能卡事件循环 | 使用 `execSync` 无 timeout |

---

## 设计方案：离线执行（Offline Execution）

核心原则：**AI 步骤可选可降级，ffmpeg 执行不依赖网络，只在开始和结束时联网。**

### 架构变更

```
旧（脆弱）：
  拉 job → [每步都 await 云端] → 完成

新（健壮）：
  启动恢复 stale job
  拉 job（一次）
  AI 富化（各有 timeout + fallback，不阻塞主流程）
  本地 ffmpeg（无网络依赖）
  上报完成（retry 3x）
```

### 变更清单

#### 1. 移除 BGM（Agent 侧）

BGM 是 PiAPI 外部生成，与视频剪辑核心无关。Agent 不再调用 `/api/ai-video/jobs/:id/bgm`。  
ffmpeg encode 时 `hasBgm = false`，直接映射原始音频。  
影响：输出视频无背景音乐（BGM 本来就是可选的，且经常 504）。

#### 2. fetchWithTimeout wrapper

```typescript
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

各步骤 timeout 设定：

| 步骤 | Timeout | 失败行为 |
|---|---|---|
| transcribe | 20s | fallback: 用 topic 文本 |
| design | 15s | fallback: 单场景默认值 |
| compose-html | 10s | 静默跳过 |
| progress update | 5s | fire-and-forget，不抛异常 |
| complete（PUT） | 15s，retry 3x，2s backoff | 最终失败写本地日志 |
| apiGet（拉 job） | 10s | 轮询下一轮重试 |

#### 3. ffprobe 改异步

```typescript
// 旧
execSync(`"${ffprobe}" ...`)

// 新
await execFileAsync(ffprobePath, [...args], { timeout: 30_000 })
```

#### 4. Stale Job 恢复

Agent 启动时，查询属于本 agent 且超过 5 分钟未更新的 processing job，批量重置为 pending：

```
GET /api/ai-video/jobs?status=processing&stale_minutes=5
→ 对每个 job PATCH { status: 'pending', progress: 0 }
```

API 侧需新增 `stale_minutes` 查询参数支持（见下方 API 变更）。

#### 5. Progress Fire-and-Forget

```typescript
function fireProgress(apiBase, id, pct) {
  fetchWithTimeout(`${apiBase}/api/ai-video/jobs/${id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ progress: pct, status: 'processing' }),
  }, 5_000).catch(() => {}); // 不 await，不抛
}
```

#### 6. Complete with Retry

```typescript
async function reportComplete(apiBase, id, payload, attempt = 0) {
  try {
    await fetchWithTimeout(`${apiBase}/api/ai-video/jobs/${id}/complete`, {
      method: 'PUT', body: JSON.stringify(payload),
    }, 15_000);
  } catch {
    if (attempt < 3) {
      await sleep(2_000);
      return reportComplete(apiBase, id, payload, attempt + 1);
    }
    // 本地写失败日志，不抛（避免 catch block 再触发 complete）
    console.error(`[video-pipeline] complete failed after 3 retries, job=${id}`);
  }
}
```

### API 侧变更（最小）

`GET /api/ai-video/jobs` 新增可选参数 `stale_minutes`：
- 若传入，返回 `status=processing` 且 `updated_at < NOW() - stale_minutes * interval`
- 默认不影响现有逻辑

### Nginx 变更

在 `/api/ai-video/jobs`（精确路径）location 之前，新增：

```nginx
location /api/ai-video/ {
    proxy_pass http://zenithjoy-api:5200/api/ai-video/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120;
    proxy_send_timeout 120;
}
```

覆盖所有 `/api/ai-video/` 子路径（transcribe/design/bgm/complete 等），120s 足够 OpenRouter + PiAPI。

### 版本

`services/agent/package.json`: `"version": "1.0.1"` → `"1.1.0"`

---

## 测试策略

| 测试类型 | 内容 |
|---|---|
| Unit | `fetchWithTimeout` 在 AbortController 触发时 throw；`fireProgress` 失败不 throw；`reportComplete` retry 3x |
| Unit | `findFfmpeg` fallback 路径逻辑（现有，不改） |
| Integration | `processVideoPipelineJob` 端到端：给定本地 fixture 视频 + mock API，验证输出 `9_16.mp4` 存在，complete 被调用 |
| E2E smoke | `.github/workflows/scripts/smoke/` — Agent 启动 → 创建 job → 等待 completed → 验证输出文件 |

---

## 交付物

1. `services/agent/src/handlers/video-pipeline.ts` 完整重写
2. `apps/api/src/controllers/ai-video-pipeline.controller.ts`（或 service）加 `stale_minutes` 参数
3. `services/agent/package.json` version bump → 1.1.0
4. nginx.conf 更新（HK VPS）
5. 重建 install pack → v1.1.0 tar.gz
6. 更新 HK VPS manifest.json + install-pack 目录
