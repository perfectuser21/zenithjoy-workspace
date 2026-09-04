package com.zenithjoy.agent.collect

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 真机复现 2026-07-17（苏彦卿账号，MAA-AN00 华为机型）：关键词"鱼香肉丝"打字进搜索框后，
 * 提交搜索前那段 `delay()` 期间手机屏幕黑掉/被系统冻结，协程再没醒过来——`triggerSearch()`
 * 从未被调用，而唯一的看门狗 `startSearchResultTimeout()` 是在 `triggerSearch()` 内部才启动
 * 的，导致任务永久卡在 WAITING/SUBMITTING 状态，服务端 `acquisition_keyword_tasks.status`
 * 停在 processing 几十分钟不动，既不成功也不报错。
 *
 * 本机无 Android SDK 跑不了需要真实 PowerManager/AccessibilityService 的单测，走源码
 * 静态断言（同 ManifestForegroundServiceTypeTest/NetworkSecurityConfigTest 的做法）。
 */
class DouyinCollectServiceWakeLockTest {

    private fun manifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    private fun serviceSource(): String {
        val candidates = listOf(
            File("src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"),
            File("app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("DouyinCollectService.kt not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    @Test
    fun `manifest declares WAKE_LOCK permission`() {
        assertTrue(
            "采集任务执行期间需要持有 WakeLock 防止屏幕黑/系统冻结时协程卡死，缺这个权限申请不到锁",
            manifestText().contains("android.permission.WAKE_LOCK"),
        )
    }

    @Test
    fun `startCollect acquires a wake lock before driving Douyin UI`() {
        val src = serviceSource()
        assertTrue(
            "startCollect（Stage1 关键词搜索入口）必须在启动采集前拿到 wakeLock，否则屏幕一黑协程就可能冻结",
            // 窗口 400→800：OpenClaw 信号桥·件1 在入口最前面加了 lease 拒单守卫（守卫必须在
            // 一切状态变更之前，包括拿 wakeLock），把 acquire 推后了约 300 字符；断言意图不变。
            Regex("private fun startCollect\\([^)]*\\)[\\s\\S]{0,800}acquireCollectWakeLock").containsMatchIn(src),
        )
    }

    @Test
    fun `startStage2Collect acquires a wake lock before driving Douyin UI`() {
        val src = serviceSource()
        assertTrue(
            "startStage2Collect（Stage2 视频URL评论采集入口）同样需要 wakeLock，跟 Stage1 一样会被冻结",
            // 窗口 400→800：同 startCollect，lease 拒单守卫在入口最前，acquire 相应推后。
            Regex("private fun startStage2Collect\\([^)]*\\)[\\s\\S]{0,800}acquireCollectWakeLock").containsMatchIn(src),
        )
    }

    @Test
    fun `all three terminal completion paths release the wake lock`() {
        val src = serviceSource()
        for (fn in listOf("finishWithError", "reportResult", "reportVideoCards")) {
            val body = Regex("private fun $fn\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    }")
                .find(src)?.groupValues?.get(1)
                ?: error("$fn 函数体没找到")
            assertTrue(
                "$fn 是任务终态收尾函数之一，必须释放 wakeLock，否则锁会一直占着耗电/漏释放",
                body.contains("releaseCollectWakeLock"),
            )
        }
    }

    @Test
    fun `typeKeyword submit-search step is wrapped with an explicit timeout`() {
        val src = serviceSource()
        assertTrue(
            "打字后提交搜索前的那段 delay+triggerSearch 必须有独立超时兜底（SUBMIT_SEARCH_TIMEOUT_MS 或等价），" +
                "否则协程一旦被系统冻结，唯一的看门狗（在 triggerSearch 内部）永远没机会启动，任务永久卡死",
            src.contains("SUBMIT_SEARCH_TIMEOUT_MS"),
        )
    }
}
