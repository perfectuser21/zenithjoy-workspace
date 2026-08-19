package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 真机确诊(2026-08-19 小白 realme RMX3478)：队列僵尸死锁。
 *
 * 实录：往库里塞一个全新采集任务，设备 31 秒内就把它拉走标 running，
 * `poll: 派发 stage_1` + `collect stage_1 task:` 两行日志都打了，
 * 然后 **100 秒零日志**，DouyinCollectService 从未被拉起。
 * 强杀进程重启后，同一个任务 **3 毫秒内**就派发出去。
 *
 * 根因：`AgentService.processNextQueuedTask()` 第一行
 *   `if (collectTaskQueue.currentJob != null) return`
 * 被一个**永远不会结束**的旧 currentJob 挡住。currentJob 只有 4 条清除路径，
 * 全部依赖 DouyinCollectService 回调；而 dispatch ack 看门狗在
 * `currentAccepted == true` 之后**主动放弃**（`if (... || currentAccepted) return@launch`）。
 *
 * 于是「接了但没跑完」= 队列永久死锁：此后所有任务只入队不派发，全程零日志，
 * 服务端只看到任务被拉走标 running、10 分钟后被 sweep 成 failed、videos=0。
 * 小白 2026-08-19 当天 12 个任务全是这个形状。
 *
 * 兜底判据：currentJob 停留超过阈值就强制回收，**已 accept 的也必须回收**——
 * 正是 accept 之后才没有任何人管它。
 */
class CollectTaskQueueStaleReclaimTest {

    private val jobA = CollectJob.Stage1(taskId = "task-A", keyword = "关键词A")
    private val jobB = CollectJob.Stage1(taskId = "task-B", keyword = "关键词B")

    private fun queueAt(vararg nowValues: Long): Pair<CollectTaskQueue, MutableList<Long>> {
        val clock = nowValues.toMutableList()
        val q = CollectTaskQueue(nowProvider = { clock.first() })
        return q to clock
    }

    @Test
    fun `currentJob 停留超过阈值——强制回收并清空，队列能继续推进`() {
        val (queue, clock) = queueAt(1_000L)
        queue.enqueue(jobA)
        queue.enqueue(jobB)
        assertEquals(jobA, queue.pollNext())

        clock[0] = 1_000L + 600_000L
        val reclaimed = queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L)

        assertEquals("必须把卡住的 job 报出来（调用方要据此上报失败）", jobA, reclaimed)
        assertNull("回收后 currentJob 必须为空，否则队列继续死锁", queue.currentJob)
        assertEquals("回收后下一个任务必须能被取出", jobB, queue.pollNext())
    }

    // ── 核心：现有 ack 看门狗在 accepted 之后就撒手不管了 ──
    @Test
    fun `已 markCurrentAccepted 的 job 超时同样要回收——accept 之后才是真空区`() {
        val (queue, clock) = queueAt(0L)
        queue.enqueue(jobA)
        queue.pollNext()
        queue.markCurrentAccepted()

        clock[0] = 300_001L
        val reclaimed = queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L)

        assertEquals(jobA, reclaimed)
        assertNull(queue.currentJob)
    }

    @Test
    fun `未到阈值不回收——正常长任务不许被误杀`() {
        val (queue, clock) = queueAt(0L)
        queue.enqueue(jobA)
        queue.pollNext()

        clock[0] = 299_999L
        assertNull("差 1 毫秒也不能回收", queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L))
        assertNotNull("currentJob 必须原样保留", queue.currentJob)
    }

    @Test
    fun `没有 currentJob 时回收是无操作`() {
        val (queue, clock) = queueAt(0L)
        clock[0] = 10_000_000L
        assertNull(queue.reclaimStaleCurrent(staleTimeoutMs = 1L))
    }

    @Test
    fun `markCurrentDone 之后不再回收——已经正常结束的不算僵尸`() {
        val (queue, clock) = queueAt(0L)
        queue.enqueue(jobA)
        queue.pollNext()
        queue.markCurrentDone()

        clock[0] = 999_999L
        assertNull(queue.reclaimStaleCurrent(staleTimeoutMs = 1_000L))
    }

    @Test
    fun `每次 pollNext 重置计时——第二个 job 不继承第一个的年龄`() {
        val (queue, clock) = queueAt(0L)
        queue.enqueue(jobA)
        queue.enqueue(jobB)
        queue.pollNext()

        clock[0] = 400_000L
        assertEquals(jobA, queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L))
        assertEquals(jobB, queue.pollNext())

        clock[0] = 400_001L
        assertNull("jobB 刚取出，不能因为时钟绝对值大就被判僵尸", queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L))
    }

    @Test
    fun `回收后重新入队同一个 job 不被去重挡住——否则等于永久丢任务`() {
        val (queue, clock) = queueAt(0L)
        queue.enqueue(jobA)
        queue.pollNext()

        clock[0] = 400_000L
        queue.reclaimStaleCurrent(staleTimeoutMs = 300_000L)

        assertEquals("回收后同一 job 必须能重新入队", true, queue.enqueue(jobA))
    }
}
