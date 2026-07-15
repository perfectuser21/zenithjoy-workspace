package com.zenithjoy.agent.collect

/**
 * 通用树展开工具：DFS 前序遍历。
 *
 * 纯函数，不依赖 Android 框架，靠 [children] lambda 解耦具体节点类型（生产侧传入
 * AccessibilityNodeInfo 的 child 访问逻辑，测试侧传入普通数据类）。
 *
 * 用 DFS 前序而非 BFS：评论区无障碍树里，一条评论 item 的 `avatar → title → [eyo] → content`
 * 是同一个容器节点下的连续子节点。BFS 按层展开会把"第1层全部兄弟"排在"第2层全部孙子"
 * 前面，打乱同一条评论内部子节点的相邻顺序，让下游 [NodeExtractor.extractComments]
 * 的 avatar 锚定切段失效（一个 item 的 title/content 会被切到别的 avatar 段里）。
 * DFS 前序保证一个节点的子树完整展开完才轮到下一个兄弟，天然保持结构上的相邻关系
 * —— 真机 dump（test/resources/fixtures/douyin-comment-panel-20260715.xml）已核实。
 */
object NodeTreeFlattener {

    fun <T> flattenDfs(root: T, maxNodes: Int, children: (T) -> List<T>): List<T> {
        val result = mutableListOf<T>()
        val stack = ArrayDeque<T>()
        stack.addLast(root)
        while (stack.isNotEmpty() && result.size < maxNodes) {
            val node = stack.removeLast()
            result.add(node)
            val kids = children(node)
            for (i in kids.indices.reversed()) {
                stack.addLast(kids[i])
            }
        }
        return result
    }
}
