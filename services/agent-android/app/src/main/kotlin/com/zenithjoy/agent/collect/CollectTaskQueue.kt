package com.zenithjoy.agent.collect

import java.util.concurrent.LinkedBlockingDeque

class CollectTaskQueue {
    private val queue = LinkedBlockingDeque<CollectJob>()
    @Volatile var currentJob: CollectJob? = null
    @Volatile private var currentRetryCount = 0

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
    }

    fun markCurrentAccepted() { currentAccepted = true }

    fun markCurrentDone() { currentJob = null }

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
