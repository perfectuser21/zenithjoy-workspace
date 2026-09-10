package com.zenithjoy.agent.publish

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 刀A（发布基座段）：MediaSaver 落相册双路径守卫。
 *
 * MediaStore insert / MediaScannerConnection 是 Android 框架静态入口，纯 JVM 单测
 * mock 不了；走源码静态断言（同 AgentVersionReportingTest / NetworkSecurityConfigTest
 * 的 readSource 做法），锁两条路径与 manifest 权限声明不被后续改动悄悄删掉：
 *   - API 29+（Q+）：MediaStore Images/Video 按 mime 判 collection，insert + 写流 +
 *     IS_PENDING 置回 0 的官方流程（无需存储权限）；
 *   - API 26-28：写 /sdcard/DCIM/Camera + MediaScannerConnection.scanFile（需要
 *     WRITE_EXTERNAL_STORAGE，manifest 声明 maxSdkVersion=28 不多要权限）。
 */
class MediaSaverTest {

    private fun readSource(relativePaths: List<String>): String {
        val file = relativePaths.map { File(it) }.firstOrNull { it.exists() }
            ?: error("source file not found in $relativePaths")
        return file.readText()
    }

    private fun mediaSaverSource() = readSource(
        listOf(
            "src/main/kotlin/com/zenithjoy/agent/publish/MediaSaver.kt",
            "app/src/main/kotlin/com/zenithjoy/agent/publish/MediaSaver.kt",
        )
    )

    private fun manifestSource() = readSource(
        listOf(
            "src/main/AndroidManifest.xml",
            "app/src/main/AndroidManifest.xml",
        )
    )

    @Test
    fun `Q+ 路径走 MediaStore insert 加 IS_PENDING 流程且按 SDK 分叉`() {
        val src = mediaSaverSource()
        assertTrue(
            "API 29+ 必须走 MediaStore + IS_PENDING 官方流程（无需存储权限）",
            src.contains("IS_PENDING"),
        )
        assertTrue(
            "双路径必须按 Build.VERSION_CODES.Q 分叉",
            src.contains("Build.VERSION_CODES.Q"),
        )
    }

    @Test
    fun `按 mime 判 Images 与 Video 两个 collection 都存在`() {
        val src = mediaSaverSource()
        assertTrue("图片要落 MediaStore.Images", src.contains("MediaStore.Images"))
        assertTrue("视频要落 MediaStore.Video（发布包素材可能是视频）", src.contains("MediaStore.Video"))
    }

    @Test
    fun `legacy 26-28 路径写 DCIM Camera 并触发媒体扫描`() {
        val src = mediaSaverSource()
        assertTrue("API 26-28 legacy 路径写 DCIM/Camera", src.contains("DCIM/Camera"))
        assertTrue(
            "legacy 写完必须 MediaScannerConnection.scanFile，否则相册看不见文件",
            src.contains("MediaScannerConnection.scanFile"),
        )
    }

    @Test
    fun `manifest 声明 WRITE_EXTERNAL_STORAGE 且 maxSdkVersion 收口在 28`() {
        val manifest = manifestSource()
        assertTrue(
            "legacy 路径需要 WRITE_EXTERNAL_STORAGE 权限声明",
            manifest.contains("android.permission.WRITE_EXTERNAL_STORAGE"),
        )
        assertTrue(
            "权限必须 maxSdkVersion=28 收口——Q+ 走 MediaStore 无需该权限，多要权限过不了商店审计",
            manifest.contains("android:maxSdkVersion=\"28\""),
        )
    }
}
