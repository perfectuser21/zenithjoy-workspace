package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CollectTaskQueueTest {

    private lateinit var queue: CollectTaskQueue

    @Before
    fun setUp() {
        queue = CollectTaskQueue()
    }

    // TC-Q01: 同一 job 重复入队时只入队一次（去重）
    @Test
    fun `enqueue_same_job_twice_only_adds_once`() {
        val job = CollectJob.Stage1(taskId = "task-001", keyword = "关键词A")

        val first = queue.enqueue(job)
        val second = queue.enqueue(job)

        assertTrue("第一次入队应返回 true", first)
        assertFalse("第二次入队同一 job 应返回 false（去重）", second)
        assertEquals("队列中应只有 1 个 job", 1, queue.size())
    }

    // TC-Q01b: currentJob 和待入队 job 相同时，也去重
    @Test
    fun `enqueue_job_same_as_currentJob_is_deduplicated`() {
        val job = CollectJob.Stage1(taskId = "task-002", keyword = "关键词B")
        queue.enqueue(job)
        queue.pollNext() // currentJob = job, queue 空

        val duplicate = queue.enqueue(job)

        assertFalse("与 currentJob 相同的 job 应被去重", duplicate)
        assertEquals(0, queue.size())
    }

    // TC-Q02: 队列顺序：先进先出
    @Test
    fun `pollNext_returns_jobs_in_FIFO_order`() {
        val job1 = CollectJob.Stage1(taskId = "task-A", keyword = "词1")
        val job2 = CollectJob.Stage1(taskId = "task-B", keyword = "词2")
        val job3 = CollectJob.Stage2(taskId = "task-C", videoUrl = "https://douyin.com/video/123", videoId = "123")

        queue.enqueue(job1)
        queue.enqueue(job2)
        queue.enqueue(job3)

        queue.markCurrentDone() // 确保 currentJob = null，能正常 poll
        val first = queue.pollNext()
        queue.markCurrentDone()
        val second = queue.pollNext()
        queue.markCurrentDone()
        val third = queue.pollNext()

        assertEquals(job1, first)
        assertEquals(job2, second)
        assertEquals(job3, third)
    }

    // TC-Q03: markCurrentDone 后 isEmpty 变为 true（如果队列也空了）
    @Test
    fun `markCurrentDone_then_isEmpty_returns_true_when_queue_also_empty`() {
        val job = CollectJob.Cancel(taskId = "task-cancel-001")
        queue.enqueue(job)

        queue.pollNext() // currentJob = job
        assertFalse("处理中时队列不为空", queue.isEmpty())

        queue.markCurrentDone()
        assertTrue("markCurrentDone 且队列空时 isEmpty 应为 true", queue.isEmpty())
    }

    // TC-Q03b: 队列还有任务时，markCurrentDone 后 isEmpty 为 false
    @Test
    fun `markCurrentDone_with_remaining_jobs_isEmpty_is_false`() {
        val job1 = CollectJob.Stage1(taskId = "task-X", keyword = "词X")
        val job2 = CollectJob.Stage1(taskId = "task-Y", keyword = "词Y")
        queue.enqueue(job1)
        queue.enqueue(job2)

        queue.pollNext() // currentJob = job1
        queue.markCurrentDone()

        assertFalse("还有 job2 在队列，isEmpty 应为 false", queue.isEmpty())
    }

    // ── dispatch 重试（真机复现 2026-07-10：DouyinCollectService busy 静默丢
    // 广播后 currentJob 永不清除 → 去重挡住重入队 → 整条队列永久死锁）───────────

    // TC-Q04: retryCurrent 在上限内返回 true，超过上限返回 false
    @Test
    fun `retryCurrent_allows_up_to_max_then_gives_up`() {
        val job = CollectJob.Stage2(taskId = "task-R", videoUrl = "https://douyin.com/video/123", videoId = "123")
        queue.enqueue(job)
        queue.pollNext()

        assertTrue("第 1 次重试应允许", queue.retryCurrent(maxRetries = 2))
        assertTrue("第 2 次重试应允许", queue.retryCurrent(maxRetries = 2))
        assertFalse("超过上限应放弃", queue.retryCurrent(maxRetries = 2))
    }

    // TC-Q04b: 没有 currentJob 时 retryCurrent 返回 false
    @Test
    fun `retryCurrent_without_currentJob_returns_false`() {
        assertFalse(queue.retryCurrent(maxRetries = 2))
    }

    // TC-Q04c: pollNext 取到新 job 时重试计数归零
    @Test
    fun `retry_counter_resets_when_next_job_polled`() {
        val job1 = CollectJob.Stage1(taskId = "task-R1", keyword = "词1")
        val job2 = CollectJob.Stage1(taskId = "task-R2", keyword = "词2")
        queue.enqueue(job1)
        queue.enqueue(job2)

        queue.pollNext() // currentJob = job1
        queue.retryCurrent(maxRetries = 1)
        assertFalse("job1 重试已用尽", queue.retryCurrent(maxRetries = 1))

        queue.markCurrentDone()
        queue.pollNext() // currentJob = job2，计数应重置
        assertTrue("新 job 的重试计数应从 0 开始", queue.retryCurrent(maxRetries = 1))
    }

    // ── dispatch ack（真机复现 2026-07-10 21:32：dispatch 发出时无障碍服务尚未
    // connected，receiver 未注册，广播进虚空——没有 onReceive 也没有 busy 拒绝，
    // currentJob 永远卡死。必须正向确认：接受方回 ack，超时未 ack 由看门狗重试）──

    // TC-Q05: 新 job poll 出来时 ack 标志为未确认
    @Test
    fun `polled_job_starts_unaccepted`() {
        val job = CollectJob.Stage1(taskId = "task-ack", keyword = "词A")
        queue.enqueue(job)
        queue.pollNext()

        assertFalse("刚派发的 job 应处于未确认状态", queue.currentAccepted)
    }

    // TC-Q05b: markCurrentAccepted 后 ack 标志为已确认
    @Test
    fun `markCurrentAccepted_sets_accepted`() {
        val job = CollectJob.Stage1(taskId = "task-ack2", keyword = "词B")
        queue.enqueue(job)
        queue.pollNext()

        queue.markCurrentAccepted()

        assertTrue(queue.currentAccepted)
    }

    // TC-Q05c: 下一个 job poll 出来时 ack 标志重置
    @Test
    fun `ack_flag_resets_on_next_poll`() {
        val job1 = CollectJob.Stage1(taskId = "task-ack3", keyword = "词C")
        val job2 = CollectJob.Stage1(taskId = "task-ack4", keyword = "词D")
        queue.enqueue(job1)
        queue.enqueue(job2)

        queue.pollNext()
        queue.markCurrentAccepted()
        queue.markCurrentDone()
        queue.pollNext() // job2

        assertFalse("新 job 的 ack 标志应重置", queue.currentAccepted)
    }
}
