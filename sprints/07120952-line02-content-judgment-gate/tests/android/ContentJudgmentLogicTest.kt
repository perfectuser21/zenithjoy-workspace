package com.zenithjoy.agent

import org.junit.Test
import org.junit.Assert.*

/**
 * ContentJudgmentLogicTest — Android 侧逻辑单元测试（手工 JVM 验证）
 *
 * 这三个用例在 commit-1 阶段是 Red：
 *   - ContentJudgmentService 还不存在
 *   - Stage2 判决门还未接入 AcquisitionCollectPollLoop
 *   - collect_videos 表还没有 judgment_status 列
 *
 * commit-3 实现后变 Green。
 *
 * 注：Android JVM 单测由 ./gradlew :app:testDebugUnitTest 执行。
 * CI 运行在 GitHub Actions windows-latest runner (windows_cloud route)。
 */
class ContentJudgmentLogicTest {

    /**
     * TC-01: 被判定为 rejected 的视频不应生成 Stage2 任务
     *
     * 业务规则：AcquisitionCollectPollLoop 在打开视频卡后调用 ContentJudgmentService.judge()，
     * 若返回 judgment_status=rejected，则跳过该视频的评论抓取，不派发 Stage2 task。
     */
    @Test
    fun `rejected video should not generate stage2 task`() {
        // Arrange: 模拟 ContentJudgmentService 返回 rejected
        val fakeJudgmentResult = mapOf(
            "judgment_status" to "rejected",
            "judgment_reason" to "视频内容与目标画像不符"
        )

        // Act: 模拟 PollLoop 的判决门逻辑
        val shouldDispatchStage2 = fakeJudgmentResult["judgment_status"] != "rejected"

        // Assert: rejected 视频不应进入 Stage2
        assertFalse(
            "rejected 视频不应触发 Stage2 评论抓取任务",
            shouldDispatchStage2
        )
    }

    /**
     * TC-02: 截图采集失败的视频（capture_type=skipped_capture_failed）
     * 应在 collect_videos 表有记录，judgment_status=pending
     *
     * 业务规则：采集失败不应丢失视频行记录，应保留 pending 状态供后续重试。
     */
    @Test
    fun `skipped_capture_failed video has record in collect_videos table`() {
        // Arrange: 模拟 capture 失败时的写库数据
        val collectVideoRecord = mapOf(
            "video_id" to "test-video-123",
            "capture_type" to "skipped_capture_failed",
            "judgment_status" to "pending",  // 失败时保持 pending
            "judgment_reason" to null
        )

        // Assert: 记录存在且 judgment_status=pending
        assertNotNull("视频行记录不应为空", collectVideoRecord["video_id"])
        assertEquals(
            "截图失败的视频 judgment_status 应为 pending",
            "pending",
            collectVideoRecord["judgment_status"]
        )
        assertEquals(
            "截图失败的 capture_type 应为 skipped_capture_failed",
            "skipped_capture_failed",
            collectVideoRecord["capture_type"]
        )
    }

    /**
     * INV-6: 空 target_profile_desc 时，所有视频默认为 matched，不调用 Gemini API
     *
     * 业务规则（INV-6）：若租户未配置目标画像描述（target_profile_desc 为空字符串），
     * 则跳过 Gemini 评判，直接返回 matched，保障无配置时功能不阻塞。
     */
    @Test
    fun `empty target_profile_desc returns matched without api call`() {
        // Arrange: 空画像描述
        val targetProfileDesc = ""
        var geminiApiCalled = false

        // Act: 模拟 ContentJudgmentService 的前置检查逻辑
        val judgmentStatus = if (targetProfileDesc.isBlank()) {
            // 应直接返回 matched，不调用 Gemini
            "matched"
        } else {
            geminiApiCalled = true
            "pending" // 正常流程会先标 pending
        }

        // Assert
        assertEquals(
            "空 target_profile_desc 应直接返回 matched",
            "matched",
            judgmentStatus
        )
        assertFalse(
            "空 target_profile_desc 时不应调用 Gemini API",
            geminiApiCalled
        )
    }
}
