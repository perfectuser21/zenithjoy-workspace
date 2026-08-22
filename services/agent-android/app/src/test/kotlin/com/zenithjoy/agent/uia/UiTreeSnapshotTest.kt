package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 失败现场第三件：无障碍树快照（AI on-call 横切件 · 刀1）。
 *
 * 为什么要它：前台包名 + 诊断行（PR#1689）能告诉你"当时屏幕上是谁、哪一步死的"，
 * 但告诉不了"当时屏幕上**有什么**"——后续 AI 定位求助（把树发给 AI 问"应该点哪个"）
 * 和周报聚类（按机型×版本看失败形态）都以这份快照为原材料。没有快照，错误码再多
 * 也改不动定位器（0821 交接单教训）。
 *
 * 序列化契约：
 *   - 每节点一行，`d{深度}` 前缀 + class + id + text + desc（+ click + bounds），人和 AI 都能读
 *   - 文本清洗成单行（换行/引号不允许破坏行结构）
 *   - 三重上限：MAX_BYTES 字节 / MAX_DEPTH 层 / MAX_NODES 节点，超限截断并带标记
 *     （广播 extra 与上报请求都不允许被巨树撑爆；上限对齐主理人拍板的 64KB）
 *
 * 与 FailureScene 同做法：纯逻辑走 Node 抽象，JVM 单测不碰 Android 框架类。
 */
class UiTreeSnapshotTest {

    private class FakeNode(
        override val className: CharSequence? = "android.widget.FrameLayout",
        override val text: CharSequence? = null,
        override val contentDescription: CharSequence? = null,
        override val viewIdResourceName: String? = null,
        override val isClickable: Boolean = false,
        override val bounds: String = "[0,0][1080,2400]",
        private val children: List<FakeNode> = emptyList(),
    ) : UiTreeSnapshot.Node {
        override val childCount: Int get() = children.size
        override fun childAt(index: Int): UiTreeSnapshot.Node? = children.getOrNull(index)
    }

    @Test
    fun `单节点行包含 class-id-text-bounds 与可点击标记`() {
        val line = UiTreeSnapshot.serialize(
            FakeNode(
                className = "android.widget.Button",
                text = "私信",
                viewIdResourceName = "com.ss.android.ugc.aweme:id/msg_btn",
                isClickable = true,
                bounds = "[10,20][300,120]",
            )
        )!!
        assertTrue("缺 class", line.contains("android.widget.Button"))
        assertTrue("缺 viewId", line.contains("com.ss.android.ugc.aweme:id/msg_btn"))
        assertTrue("缺 text", line.contains("私信"))
        assertTrue("缺 bounds", line.contains("[10,20][300,120]"))
        assertTrue("缺可点击标记——AI 挑候选时第一个要看的就是它", line.contains("click"))
    }

    @Test
    fun `子节点带深度前缀便于人和 AI 看层级`() {
        val out = UiTreeSnapshot.serialize(
            FakeNode(children = listOf(FakeNode(className = "android.widget.TextView", text = "评论")))
        )!!
        assertTrue("根节点应有 d0 前缀", out.lineSequence().first().startsWith("d0 "))
        assertTrue("子节点应有 d1 前缀", out.lineSequence().any { it.startsWith("d1 ") })
    }

    @Test
    fun `文本中的换行与双引号清洗成单行，不破坏行结构`() {
        val out = UiTreeSnapshot.serialize(FakeNode(text = "a\nb\"c"))!!
        assertEquals("每节点必须恰好一行", 1, out.lineSequence().count())
        assertFalse("原始换行必须被清洗", out.contains("a\nb"))
        assertTrue("清洗后内容仍可读", out.contains("a b'c"))
    }

    @Test
    fun `超过字节上限截断并带标记`() {
        // 单字段另有 120 字符上限（预算花在广度上），所以字节截断要靠"很多中等节点"触发：
        // 600 个子节点 × 中文 text/desc 各 100 字（UTF-8 各 300 字节）≈ 每行 650B，总量远超 64KB
        val wide = FakeNode(
            children = List(600) {
                FakeNode(text = "文".repeat(100), contentDescription = "描".repeat(100))
            }
        )
        val out = UiTreeSnapshot.serialize(wide)!!
        assertTrue(
            "序列化结果 UTF-8 字节数必须 <= MAX_BYTES（含标记），实得 ${out.toByteArray(Charsets.UTF_8).size}",
            out.toByteArray(Charsets.UTF_8).size <= UiTreeSnapshot.MAX_BYTES,
        )
        assertTrue("截断必须带标记，让读的人知道现场不完整", out.contains(UiTreeSnapshot.TRUNCATION_MARK))
    }

    @Test
    fun `单节点超长字段被字段级上限清洗——树的预算花在广度上`() {
        val out = UiTreeSnapshot.serialize(FakeNode(text = "x".repeat(100_000)))!!
        assertTrue(
            "单字段应被截到字段级上限附近，实得整行 ${out.length} 字符",
            out.length < 1000,
        )
    }

    @Test
    fun `节点数上限防巨树撑爆`() {
        val wide = FakeNode(children = List(2000) { FakeNode(className = "android.view.View") })
        val out = UiTreeSnapshot.serialize(wide)!!
        assertTrue(
            "行数必须 <= MAX_NODES + 截断标记行，实得 ${out.lineSequence().count()}",
            out.lineSequence().count() <= UiTreeSnapshot.MAX_NODES + 1,
        )
        assertTrue(out.contains(UiTreeSnapshot.TRUNCATION_MARK))
    }

    @Test
    fun `深度上限防节点环与病态深树`() {
        var chain = FakeNode(className = "android.view.View")
        repeat(60) { chain = FakeNode(className = "android.view.View", children = listOf(chain)) }
        val out = UiTreeSnapshot.serialize(chain)!!
        assertFalse(
            "超过 MAX_DEPTH 的层级不应再序列化",
            out.lineSequence().any { it.startsWith("d${UiTreeSnapshot.MAX_DEPTH + 1} ") },
        )
    }

    @Test
    fun `root 为 null 返回 null——拿不到树不能因此丢掉整个现场`() {
        assertNull(UiTreeSnapshot.serialize(null))
    }
}
