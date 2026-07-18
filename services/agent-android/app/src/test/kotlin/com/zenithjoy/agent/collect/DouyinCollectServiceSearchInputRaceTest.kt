package com.zenithjoy.agent.collect

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现（偶发）：`/collect/start` 关键词采集进入搜索页后偶发 `NO_SEARCH_INPUT`，任务被
 * 判空失败终止——即便 `TYPE_WINDOW_STATE_CHANGED` 事件驱动的 `handleTypingKeyword()` 早已
 * 抢先完成打字并把 state 推进到 `SUBMITTING_SEARCH`。
 *
 * 根因：`openSearchBar()` 协程里那条直调 `typeKeyword(postClickRoot)` 完全没有状态守卫，
 * 用一份可能过期（甚至 `awaitRootInActiveWindow` 超时兜底回退到点击前、必然没有搜索框的
 * 旧 root）的快照，对一个其实已经在正常推进的任务二次判空，错误触发
 * `finishWithError("NO_SEARCH_INPUT")`，把本该成功的任务判死。
 *
 * 修法：`openSearchBar()` 直调 `typeKeyword` 前必须像 `triggerSearch()` 的单飞闩
 * （`mayStartStage1Work`）一样，先用 `shouldEnterSubmitting(state)` 确认还停在
 * `TYPING_KEYWORD`，抢先切到 `SUBMITTING_SEARCH` 再调用，跟事件驱动路径互斥——谁先到谁处理，
 * 另一条路径静默跳过。
 *
 * 本机无 Android SDK 跑不了需要真实 AccessibilityService 的单测，走源码静态断言
 * （同 DouyinCollectServiceWakeLockTest 的做法）。
 */
class DouyinCollectServiceSearchInputRaceTest {

    private fun serviceSource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("DouyinCollectService.kt not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    private fun openSearchBarBody(src: String): String {
        return Regex("private fun openSearchBar\\(\\)\\s*\\{([\\s\\S]*?)\\n    }")
            .find(src)?.groupValues?.get(1)
            ?: error("openSearchBar 函数体没找到")
    }

    @Test
    fun `openSearchBar guards its direct typeKeyword call with shouldEnterSubmitting`() {
        val body = openSearchBarBody(serviceSource())
        assertTrue(
            "openSearchBar 直调 typeKeyword 前必须先用 shouldEnterSubmitting(state) 判断还停在 " +
                "TYPING_KEYWORD——否则事件驱动的 handleTypingKeyword() 已经先完成打字并推进 state 后，" +
                "这里再用过期 root 无条件调用 typeKeyword，会把 NO_SEARCH_INPUT 错误地打在一个本该" +
                "成功的任务头上",
            Regex("shouldEnterSubmitting\\(state\\)[\\s\\S]{0,200}typeKeyword\\(").containsMatchIn(body),
        )
    }

    @Test
    fun `openSearchBar advances state to SUBMITTING_SEARCH before its direct typeKeyword call`() {
        val body = openSearchBarBody(serviceSource())
        assertTrue(
            "openSearchBar 抢到 shouldEnterSubmitting 判断后必须像 handleTypingKeyword 一样把 state " +
                "切到 SUBMITTING_SEARCH，再调用 typeKeyword，跟事件驱动路径互斥，防止两条路径都调用",
            Regex("state = State\\.SUBMITTING_SEARCH[\\s\\S]{0,100}typeKeyword\\(").containsMatchIn(body),
        )
    }
}
