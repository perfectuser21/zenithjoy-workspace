package com.zenithjoy.agent.uia

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * 失败现场第三件：无障碍树快照（AI on-call 横切件 · 刀1）。
 *
 * 把失败那一刻的无障碍树序列化成紧凑文本行——人和 AI 都能直接读：
 *   `d{深度} {class} id={viewId} text="{text}" desc="{desc}" click bounds=[l,t][r,b]`
 *
 * 它是后续两条管线的原材料：
 *   - AI 定位求助（刀2）：把这份树发给 AI 问"应该点哪个 node"
 *   - 周报固化（刀3）：按机型×版本聚类失败形态，把 AI 的稳定答案写进定位器发版
 *
 * 三重上限（都不许拍脑袋放开——广播 extra 与上报请求不允许被巨树撑爆）：
 *   MAX_BYTES 对齐主理人拍板的 64KB；MAX_DEPTH 防节点环/病态深树；MAX_NODES 防超宽列表页。
 *
 * 与 FailureScene 同做法：纯逻辑走 [Node] 抽象，JVM 单测不碰 Android 框架类；
 * [fromAccessibilityNode] 是唯一碰框架的薄适配层。
 */
object UiTreeSnapshot {

    const val MAX_BYTES = 64 * 1024
    const val MAX_DEPTH = 30
    const val MAX_NODES = 800
    const val TRUNCATION_MARK = "...[truncated]"

    /** 单节点字段清洗后各自的长度上限——树的预算应花在广度上，不该被一个超长文案吃光。 */
    private const val FIELD_MAX_LEN = 120

    interface Node {
        val className: CharSequence?
        val text: CharSequence?
        val contentDescription: CharSequence?
        val viewIdResourceName: String?
        val isClickable: Boolean
        /** 屏幕坐标包围盒，格式 [l,t][r,b]。 */
        val bounds: String
        val childCount: Int
        fun childAt(index: Int): Node?
    }

    /**
     * 序列化整棵树。root 为 null 返回 null——拿不到树不能因此丢掉整个现场
     * （与 FailureScene 前台包名同一原则）。
     */
    fun serialize(root: Node?): String? {
        if (root == null) return null
        val sb = StringBuilder()
        var bytes = 0
        var nodes = 0
        var truncated = false
        val markBytes = TRUNCATION_MARK.toByteArray(Charsets.UTF_8).size + 1

        fun walk(node: Node, depth: Int) {
            if (truncated) return
            if (depth > MAX_DEPTH) return
            if (nodes >= MAX_NODES) {
                truncated = true
                return
            }
            val line = formatLine(node, depth)
            val lineBytes = line.toByteArray(Charsets.UTF_8).size + 1
            // 预留截断标记的空间，保证最终结果永远 <= MAX_BYTES
            if (bytes + lineBytes + markBytes > MAX_BYTES) {
                truncated = true
                return
            }
            if (sb.isNotEmpty()) sb.append('\n')
            sb.append(line)
            bytes += lineBytes
            nodes += 1
            for (i in 0 until node.childCount) {
                if (truncated) return
                walk(node.childAt(i) ?: continue, depth + 1)
            }
        }

        walk(root, 0)
        if (truncated) {
            if (sb.isNotEmpty()) sb.append('\n')
            sb.append(TRUNCATION_MARK)
        }
        return sb.toString()
    }

    private fun formatLine(node: Node, depth: Int): String {
        val cls = sanitize(node.className) ?: "-"
        val id = node.viewIdResourceName?.takeIf { it.isNotBlank() } ?: "-"
        val text = sanitize(node.text) ?: "-"
        val desc = sanitize(node.contentDescription) ?: "-"
        val click = if (node.isClickable) " click" else ""
        return "d$depth $cls id=$id text=\"$text\" desc=\"$desc\"$click bounds=${node.bounds}"
    }

    /** 单行化：换行/制表符 → 空格，双引号 → 单引号（不许破坏行结构），超长截断。 */
    private fun sanitize(s: CharSequence?): String? {
        val v = s?.toString()?.takeIf { it.isNotBlank() } ?: return null
        return v.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
            .replace('"', '\'')
            .take(FIELD_MAX_LEN)
    }

    /** 唯一碰 Android 框架的薄适配层——JVM 单测不走这里。 */
    fun fromAccessibilityNode(node: AccessibilityNodeInfo): Node = object : Node {
        override val className: CharSequence? get() = node.className
        override val text: CharSequence? get() = node.text
        override val contentDescription: CharSequence? get() = node.contentDescription
        override val viewIdResourceName: String? get() = node.viewIdResourceName
        override val isClickable: Boolean get() = node.isClickable
        override val bounds: String
            get() {
                val r = Rect()
                node.getBoundsInScreen(r)
                return "[${r.left},${r.top}][${r.right},${r.bottom}]"
            }
        override val childCount: Int get() = node.childCount
        override fun childAt(index: Int): Node? =
            runCatching { node.getChild(index) }.getOrNull()?.let { fromAccessibilityNode(it) }
    }
}
