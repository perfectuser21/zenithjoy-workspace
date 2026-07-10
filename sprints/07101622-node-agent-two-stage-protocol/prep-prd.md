# PrepPRD: node agent 两阶段协议（PR2a）

**日期**: 2026-07-10  
**Sprint**: 07101622-node-agent-two-stage-protocol  
**任务 ID**: Brain dev task（多视频协议闭环 PR2a）  
**对应拆刀**: 本刀只做 node 端；Android 端=PR2b（另立任务 6335e1e3）

---

## 用户能看到什么（验收语言）

1. 系统搜完**所有关键词**后，一次性把视频清单送上去，不再一条一条送、不再用 `terminal='stage_1'` 变通触发 Stage1 结算
2. 某条视频评论区爬失败（网络断/超时/Chrome 未就绪），该条**跳过不上报**，不影响其他视频继续采集；服务端在配置的超时窗口内发现该视频没被打时间戳，会自动重派给 agent
3. 管理后台里不再出现「明明开始采集却卡在 running / stage_1_done 无法推进」的任务——旧双轨（SSE collect loop + line02 模块）消费同一任务的竞态已根治
4. 抖音 session 过期时，burner 会被自动 invalidate 标记，不再反复派同一个失效账号

---

## 范围

**本刀修改**：`services/agent/modules/line02/index.ts`、`services/agent/src/index.ts`、单测、smoke、`services/agent/package.json` 版本 bump

**不碰**：`apps/api/`（服务端 PR1-2 已合并）、`services/agent-android/`（PR2b）

---

## 契约参考

- **响应码表 §1.4**：`sprints/07091806-android-collect-protocol-v2/contract-stage1-report-videos.md`
- **空清单三分支 §1.6**：同上
- **状态机 §3**：同上

---

## 核心变更说明

### Stage1：改点到面

| 旧行为 | 新行为 |
|--------|--------|
| 每个关键词搜完立即 POST `/collect/report`（逐条上报，末条 `terminal='stage_1'`） | 搜完全部关键词→汇总→一次 POST `/collect/report-videos` |
| `video_id` 从 URL 末段 `.split('/').pop()` 提取（不稳定） | 正则 `/\/video\/(\d+)/` 提取，不匹配丢弃 |
| 关键词空时还是会报一条 `video_id='no-result-...'` 假视频 | 空→`reason.search_result='empty'`；错误→`reason.error_code=<code>` |

### Stage2：区分失败与真 0 条

| 旧行为 | 新行为 |
|--------|--------|
| `spawnCommentCrawl` 超时/崩溃 → 返回 `[]`，照样发 report（假装 0 条评论） | 返回 `{ ok: false, commenters: [] }`，`ok:false` 时跳过 report，留服务端 sweep |
| 末条发 `terminal:'done'` 让服务端结算 | 不再发 terminal，服务端全回完自动 done |

### 删除双轨

- 删除 `src/index.ts` 中的 `processCollectTask`（L1246-1298）和 `startAcquisitionCollectLoop`（L1301-1373）
- 删除 L596 的 `startAcquisitionCollectLoop(cfg)` 调用
- `startAcquisitionKeywordLoop`（另一张表）保留不动

### 硬化点

- `apiRequest`：`{ statusCode, body }` 返回值；30s 超时；JSON parse 失败不再 `ok:true` 兜底
- 重试分级：网络/5xx→3次指数退避；400/401/404→不重试；409/403 AGENT_MISMATCH→abandon；403 UNKNOWN_AGENT→stopPoll；agentId 空→跳过 poll
- 子进程 `on('error')` 补充（ENOENT 等不再崩模块进程）
- 搜索子进程每关键词 120s 超时（`ZENITHJOY_SEARCH_TIMEOUT_MS` env 可覆盖）
- DOUYIN_SESSION_EXPIRED → 保留 burner invalidate 副作用
