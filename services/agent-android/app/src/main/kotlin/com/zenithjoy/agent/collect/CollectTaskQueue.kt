package com.zenithjoy.agent.collect

import java.util.concurrent.LinkedBlockingDeque

class CollectTaskQueue {
    private val queue = LinkedBlockingDeque<CollectJob>()
    @Volatile var currentJob: CollectJob? = null

    // 去重：同一 taskId+keyword/videoUrl 不重复入队
    fun enqueue(job: CollectJob): Boolean {
        val isDuplicate = currentJob == job || queue.any { it == job }
        if (isDuplicate) return false
        queue.addLast(job)
        return true
    }

    fun pollNext(): CollectJob? = queue.pollFirst()?.also { currentJob = it }

    fun markCurrentDone() { currentJob = null }

    fun isEmpty(): Boolean = queue.isEmpty() && currentJob == null

    fun size(): Int = queue.size
}
