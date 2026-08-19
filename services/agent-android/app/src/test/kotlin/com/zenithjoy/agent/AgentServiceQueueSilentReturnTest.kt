package com.zenithjoy.agent

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 真机确诊(2026-08-19 小白)：`processNextQueuedTask()` 的两个 `return` 都是**静默**的——
 *
 *   if (collectTaskQueue.currentJob != null) return   // 队列被僵尸 job 堵死，零日志
 *   val next = collectTaskQueue.pollNext() ?: return  // 队列空，零日志
 *   dispatchJob(next)                                  // 第一行日志在这里才出现
 *
 * 后果：设备把任务从中台拉走（标 running）之后一声不吭，外部完全看不出它被吞在哪一步。
 * 这与 PR#1662「采集轮询 5 个静默丢弃点全部留痕」是同一类病，只是漏掉了队列这一层。
 *
 * 本测试是源码级机械闸：两个 return 分支都必须留痕，谁把日志删了 CI 立刻报红。
 */
class AgentServiceQueueSilentReturnTest {

    private fun agentServiceSource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt"),
        )
        return (candidates.firstOrNull { it.exists() }
            ?: error("AgentService.kt not found in ${candidates.map { it.absolutePath }}"))
            .readText()
    }

    private fun processNextQueuedTaskBody(): String {
        val source = agentServiceSource()
        val start = source.indexOf("private fun processNextQueuedTask()")
        assertTrue("processNextQueuedTask 不见了", start >= 0)
        val end = source.indexOf("\n    private fun ", start + 1).let { if (it == -1) source.length else it }
        return source.substring(start, end)
    }

    @Test
    fun `currentJob 占用导致的早退必须留痕`() {
        val body = processNextQueuedTaskBody()
        val busyBranch = body.substringBefore("pollNext()")

        assertTrue(
            "currentJob != null 的早退分支必须打日志，否则队列死锁在外部完全不可见（小白烧掉一整天）",
            busyBranch.contains("Log."),
        )
        assertTrue(
            "早退日志必须带上是哪个 taskId 占着队列，否则日志有等于没有",
            busyBranch.contains("taskId"),
        )
    }

    @Test
    fun `队列空的早退也必须留痕`() {
        val body = processNextQueuedTaskBody()
        val emptyBranch = body.substringAfter("pollNext()").substringBefore("dispatchJob(")

        assertTrue(
            "pollNext() 返回 null 的早退分支必须打日志",
            emptyBranch.contains("Log."),
        )
    }

    @Test
    fun `僵尸回收必须真的被接线进来——只加日志不加兜底等于白修`() {
        val source = agentServiceSource()

        assertTrue(
            "AgentService 必须调用 reclaimStaleCurrent，否则卡死的 currentJob 依然没人清",
            source.contains("reclaimStaleCurrent"),
        )
        assertTrue(
            "回收掉的任务必须带 AGENT_QUEUE_STALLED 向中台上报失败，" +
                "不能静默丢弃等服务端 10 分钟后 sweep（那期间设备是哑的、中台以为它在干活）",
            source.contains("AGENT_QUEUE_STALLED"),
        )
    }
}
