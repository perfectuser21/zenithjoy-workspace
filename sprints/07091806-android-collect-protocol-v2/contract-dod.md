# DoD — 安卓端补全采集两阶段协议

## 行为断言（必须全部通过方可 merge）

[BEHAVIOR] TC-001: AcquisitionCollectPollLoop.pollOnce() 在 agentId 非空时，发出 GET 请求携带 x-agent-id 头并命中 /pending-collect-tasks 路径
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_carriesAgentIdHeader*"

[BEHAVIOR] TC-002: AcquisitionCollectPollLoop.pollOnce() 收到 stage:"stage_1" 任务且 keywords 非空时，对每个关键词调用 onStage1Task 回调，回调次数 = keywords.size
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_stage1_invokesOnStage1TaskPerKeyword*"

[BEHAVIOR] TC-003: AcquisitionCollectPollLoop.pollOnce() 收到 stage:"stage_2" 任务且 video_urls 非空时，调用 onStage2Task 回调并传入完整 video_urls 列表
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_stage2_invokesOnStage2TaskWithVideoUrls*"

[BEHAVIOR] TC-004: AcquisitionCollectPollLoop.pollOnce() 返回空 tasks 列表时，不触发任何回调（onStage1Task/onStage2Task/onCancel 均不调用）
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_emptyTasks_noCallbackInvoked*"

[BEHAVIOR] TC-005: AcquisitionCollectPollLoop.pollOnce() 收到 status:"cancelling" 任务时，调用 onCancel 回调，且不调用 onStage1Task / onStage2Task
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_cancellingStatus_invokesOnCancelOnly*"

[BEHAVIOR] TC-006: AcquisitionCollectPollLoop.pollOnce() 在 agentId 为空字符串时，跳过 HTTP 请求（MockWebServer.requestCount == 0）
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_emptyAgentId_skipsRequest*"

[BEHAVIOR] TC-007: AcquisitionCollectPollLoop.pollOnce() 处理 stage_1 任务时，onStage1Task 回调最多触发 N=3 次（每关键词视频上限）
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_stage1_maxNVideosPerKeyword*"

[BEHAVIOR] TC-008: AcquisitionCollectPollLoop.pollOnce() HTTP 500 响应时，不抛出异常，不触发任何回调，循环可继续
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "*AcquisitionCollectPollLoopTest.pollOnce_http500_doesNotCrash*"

## 全量运行（CI 用）
manual:bash: ./gradlew -p services/agent-android :app:testDebugUnitTest --tests "com.zenithjoy.agent.AcquisitionCollectPollLoopTest"

---

## 铁律清单

- [ ] PR 推进 Path 2 Step 5（安卓 Agent 采集闭环，`AcquisitionCollectPollLoop` 接通 `/pending-collect-tasks`）
- [ ] thin → medium：commit-1 写失败测试（`AcquisitionCollectPollLoopTest.kt`），commit-2 写实现（`AcquisitionCollectPollLoop.kt` + `AgentService.kt` 集成 + `acquisition.ts` stage_1_done 判断）
- [ ] 测试文件在 PR diff 里（`app/src/test/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoopTest.kt`）且 CI `testDebugUnitTest` job 收集
- [ ] smoke 脚本路径进 `.github/workflows/scripts/smoke-baseline.txt`
- [ ] `AgentService.onDestroy()` 补 `collectPollLoop?.stop()`，不泄漏协程
- [ ] `onCollectResult` 回调内 collectTaskIds Set 判断路由正确（新协议走 `/collect/report`，旧协议走 `/comment-score-result`）

---

## NFR 验收

- [ ] 轮询间隔 30s ± 2s 随机抖动（`intervalMs` 默认值，不暴露配置项）
- [ ] Stage1 每关键词最多 3 个视频（N=3，hardcoded `MAX_VIDEOS_PER_KEYWORD = 3`）
- [ ] 取消检测延迟 ≤30s（在下一轮轮询内响应 `status="cancelling"`）
- [ ] HTTP 失败最多重试 1 次（退避 5s），不因单视频网络失败中止整个任务
- [ ] `ScanMutex.busy` 在采集任务运行期为 `true`，结束或取消后复位
- [ ] `resultReported` 原子布尔保证同一任务只上报一次 `terminal=true`

---

## Stage1 服务端配合（唯一需要改的服务端逻辑）

`apps/api/src/routes/acquisition.ts`，在 `collect/report` handler 增加：

```typescript
// Stage1 完成判断：当 terminal=false 且视频计数已达 keywords.length × N 时，推进为 stage_1_done
if (!body.terminal && task.stage === 'stage_1') {
  const videoCount = await countCollectVideos(task.id)  // 含本次新插入
  const expectedCount = (task.keywords?.length ?? 0) * MAX_VIDEOS_PER_KEYWORD
  if (videoCount >= expectedCount) {
    await updateCollectTaskStage(task.id, 'stage_1_done')
  }
}
```

manual:bash: curl -s -X POST http://localhost:3000/api/acquisition/collect/report \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d '{"task_id":"'$TASK_ID'","video_id":"vid1","commenters":[],"checkpoint":{"last_video_id":"vid1","processed_video_ids":["vid1"]},"terminal":false}' \
  | jq '.success'
