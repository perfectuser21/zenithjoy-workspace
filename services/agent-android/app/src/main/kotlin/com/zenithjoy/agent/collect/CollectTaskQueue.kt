package com.zenithjoy.agent.collect

import java.util.concurrent.LinkedBlockingDeque

class CollectTaskQueue(
    /** 注入时钟，单测可控；生产用系统时钟。 */
    private val nowProvider: () -> Long = { System.currentTimeMillis() },
) {
    private val queue = LinkedBlockingDeque<CollectJob>()
    @Volatile var currentJob: CollectJob? = null
    @Volatile private var currentRetryCount = 0
    @Volatile private var currentStartedAtMs: Long = 0L

    // dispatch 正向确认：广播可能进虚空（真机实录 2026-07-10 21:32——无障碍服务
    // 未 connected 时 receiver 未注册，没有 onReceive 也没有 busy 拒绝）。
    // 接受方开工时回 ack，超时未 ack 由派发方看门狗重试。
    @Volatile var currentAccepted = false
        private set

    // 去重：同一 taskId+keyword/videoUrl 不重复入队
    fun enqueue(job: CollectJob): Boolean {
        val isDuplicate = currentJob == job || queue.any { it == job }
        if (isDuplicate) return false
        queue.addLast(job)
        return true
    }

    fun pollNext(): CollectJob? = queue.pollFirst()?.also {
        currentJob = it
        currentRetryCount = 0
        currentAccepted = false
        currentStartedAtMs = nowProvider()
    }

    fun markCurrentAccepted() { currentAccepted = true }

    fun markCurrentDone() { currentJob = null }

    /**
     * 僵尸 currentJob 强制回收——队列死锁的**最后一道兜底**。
     *
     * 真机确诊(2026-08-19 小白 realme RMX3478)：currentJob 只有 4 条清除路径，全部依赖
     * DouyinCollectService 回调；而 `AgentService.startDispatchAckWatchdog` 在
     * `currentAccepted == true` 之后**主动放弃**（`if (... || currentAccepted) return@launch`）。
     * 于是「接了但没跑完」这一种失败——服务被 ROM 杀掉、抖音拉不起走了无回调的错误分支——
     * 就落进了完全没人管的真空区：currentJob 永久挂着，
     * `AgentService.processNextQueuedTask()` 第一行 `if (currentJob != null) return` 把
     * 此后所有任务全部挡在门外，只入队不派发、全程零日志。
     * 实录：新任务 31 秒被拉走后 100 秒零日志，强杀进程重启后同一任务 3 毫秒即派发。
     *
     * 因此本方法**不看 currentAccepted**——accept 之后才是真空区，只看它停留了多久。
     *
     * @return 被回收的 job（调用方须据此向中台上报失败），null = 无需回收
     */
    fun reclaimStaleCurrent(staleTimeoutMs: Long): CollectJob? {
        val stale = currentJob ?: return null
        if (nowProvider() - currentStartedAtMs < staleTimeoutMs) return null
        currentJob = null
        currentAccepted = false
        currentRetryCount = 0
        return stale
    }

    /**
     * dispatch 被 DouyinCollectService busy 拒绝后的重试记账。
     * 真机复现(2026-07-10)：busy 静默丢广播后 currentJob 永不清除，去重又挡住
     * 重入队 → 队列永久死锁。改为拒绝时显式重试，上限内返回 true（调用方重发
     * dispatch），超限返回 false（调用方 markCurrentDone 放弃该 job，队列继续推进）。
     */
    fun retryCurrent(maxRetries: Int): Boolean {
        if (currentJob == null) return false
        if (currentRetryCount >= maxRetries) return false
        currentRetryCount++
        return true
    }

    fun isEmpty(): Boolean = queue.isEmpty() && currentJob == null

    fun size(): Int = queue.size
}
