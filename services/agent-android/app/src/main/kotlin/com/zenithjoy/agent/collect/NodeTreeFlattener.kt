package com.zenithjoy.agent.collect

/**
 * 通用树展开工具：DFS 前序遍历。
 *
 * 纯函数，不依赖 Android 框架，靠 [children] lambda 解耦具体节点类型（生产侧传入
 * AccessibilityNodeInfo 的 child 访问逻辑，测试侧传入普通数据类）。
 *
 * 用 DFS 前序而非 BFS：评论区无障碍树里，一条评论的"昵称→正文→元信息"是同一个
 * 容器节点的连续子节点。BFS 按层展开会把"第1层全部兄弟"排在"第2层全部孙子"前面，
 * 打乱同一条评论内部子节点的相邻顺序，让下游"相邻文本配对"的启发式失效
 * （见 NodeExtractor.extractByStructure）。DFS 前序保证一个节点的子树完整展开完
 * 才轮到下一个兄弟，天然保持视觉/结构上的相邻关系。
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
