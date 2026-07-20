package com.zenithjoy.agent.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * dumpNodesGeneric：无障碍树摘要 dump 的纯逻辑核心（sprint 07201209，账号扫描失败诊断）。
 * 用普通 Kotlin 测试对象代替 AccessibilityNodeInfo——本仓库测试环境无 Mockito/Robolectric，
 * 无法 mock Android 框架类，照抄 ScreenCaptureService 的"注入 lambda 分离纯逻辑"写法。
 */
class DeviceAccountScanServiceTreeDumpTest {

    /** 测试专用的极简树节点，不依赖任何 Android 类型。 */
    data class FakeNode(
        val className: String = "android.widget.TextView",
        val text: String? = null,
        val contentDesc: String? = null,
        val clickable: Boolean = false,
        val boundsWH: Pair<Int, Int> = 0 to 0,
        val children: List<FakeNode> = emptyList(),
    )

    private fun dump(root: FakeNode?, limit: Int = 80): String = dumpNodesGeneric(
        root = root,
        limit = limit,
        getClassName = { it.className },
        getText = { it.text },
        getContentDesc = { it.contentDesc },
        getClickable = { it.clickable },
        getBoundsWH = { it.boundsWH },
        getChildCount = { it.children.size },
        getChild = { node, i -> node.children.getOrNull(i) },
    )

    @Test
    fun `root为null时返回占位字符串不崩溃`() {
        val result = dump(null)
        assertTrue(result.contains("root=null"))
    }

    @Test
    fun `有意义节点(有文字或可点击)会出现在输出里，纯空节点不占行`() {
        val leaf1 = FakeNode(text = "切换账号", clickable = true)
        val leaf2 = FakeNode() // 无文字、无描述、不可点击 —— 应被跳过
        val root = FakeNode(className = "android.widget.FrameLayout", children = listOf(leaf1, leaf2))

        val result = dump(root)

        assertTrue(result.contains("切换账号"))
        assertTrue(result.contains("click=true"))
        // 只有 1 个有意义节点被打印（root 本身无文字/不可点击也被跳过，leaf2 也跳过）
        assertEquals(1, result.lines().count { it.contains("#") })
    }

    @Test
    fun `超过limit则停止遍历`() {
        val children = (1..100).map { FakeNode(text = "node$it", clickable = true) }
        val root = FakeNode(children = children)

        val result = dump(root, limit = 5)

        assertTrue(result.contains("printed=5"))
    }
}
