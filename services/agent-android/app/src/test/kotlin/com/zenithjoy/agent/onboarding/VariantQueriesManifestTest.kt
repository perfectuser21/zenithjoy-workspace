package com.zenithjoy.agent.onboarding

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 安卓 11+ 包可见性：targetSdk 30+ 查别的包必须在 AndroidManifest 声明 `<queries>`，
 * 否则 `getPackageInfo` 抛 NameNotFoundException——**是"合法失败"不是报错**，
 * 会被静默误判成"同族变体包没装"，互斥闸直接形同虚设，且没有任何迹象。
 *
 * 这个坑本仓库已经踩过一次（manifest 里抖音那条 `<queries>` 的注释就是当时留下的：
 * "症状是合法失败而不是抛异常，很容易被误判成别的原因"）。互斥闸依赖同一个机制，
 * 所以必须有机械闸看住这两行声明，不能靠人记得。
 */
class VariantQueriesManifestTest {

    private fun manifestSource(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        return (candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found in ${candidates.map { it.absolutePath }}"))
            .readText()
    }

    @Test
    fun `queries 必须声明全部同族变体包，否则互斥闸查不到别的包`() {
        val manifest = manifestSource()
        val queriesBlock = manifest.substringAfter("<queries>", "").substringBefore("</queries>", "")

        assertTrue("manifest 里找不到 <queries> 块", queriesBlock.isNotEmpty())

        val required = siblingVariantPackages("com.zenithjoy.agent") +
            siblingVariantPackages("com.zenithjoy.agent.e2e")

        required.distinct().forEach { pkg ->
            assertTrue(
                "<queries> 缺少 $pkg —— 安卓 11+ 下 getPackageInfo 会静默查不到，互斥闸形同虚设",
                queriesBlock.contains("\"$pkg\""),
            )
        }
    }
}
