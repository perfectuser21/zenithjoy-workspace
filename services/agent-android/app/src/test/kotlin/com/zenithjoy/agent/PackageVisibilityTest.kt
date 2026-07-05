package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：真机验证复现——DouyinCollectService.launchDouyin() 调
 * PackageManager.getLaunchIntentForPackage("com.ss.android.ugc.aweme") 拿到 null
 * （不是抛异常，是"合法失败"），根因是 Android 11+ 包可见性限制：targetSdk 30+
 * 查询其他包信息前必须在 manifest 声明 <queries>，没声明就被系统过滤看不到。
 * monkey 命令能拉起抖音证明包本身没问题，纯粹是我们代码这边查不到。
 */
class PackageVisibilityTest {

    private fun manifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    @Test
    fun `manifest declares queries visibility for douyin package`() {
        val manifest = manifestText()
        assertTrue(
            "manifest 必须有 <queries> 块，否则 getLaunchIntentForPackage 对抖音包返回 null",
            manifest.contains("<queries>"),
        )
        assertTrue(
            "queries 里必须声明抖音包名 com.ss.android.ugc.aweme",
            manifest.contains("android:name=\"com.ss.android.ugc.aweme\""),
        )
    }
}
