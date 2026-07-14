package com.zenithjoy.agent.collect

import org.junit.Assert.*
import org.junit.Test

class NodeTreeFlattenerTest {

    private data class TestNode(val id: Int, val children: List<TestNode> = emptyList())

    @Test
    fun `dfs preorder visits a subtree fully before moving to next sibling`() {
        // 树结构：
        //        1
        //       / \
        //      2   5
        //     / \
        //    3   4
        val tree = TestNode(1, listOf(
            TestNode(2, listOf(TestNode(3), TestNode(4))),
            TestNode(5),
        ))

        val order = NodeTreeFlattener.flattenDfs(tree, maxNodes = 100) { it.children }.map { it.id }

        // DFS 前序：1,2,3,4,5 —— 2 的子树(3,4)必须在 5 之前展开完，
        // 保证"同一评论 item 内部子节点"在列表里视觉相邻，不被兄弟节点(5)打断。
        assertEquals(listOf(1, 2, 3, 4, 5), order)
    }

    @Test
    fun `dfs preorder differs from bfs order on multi-branch tree`() {
        val tree = TestNode(1, listOf(
            TestNode(2, listOf(TestNode(3))),
            TestNode(4, listOf(TestNode(5))),
        ))

        val order = NodeTreeFlattener.flattenDfs(tree, maxNodes = 100) { it.children }.map { it.id }

        // BFS 会得到 [1,2,4,3,5]（同层先展开完）；DFS 前序必须是 [1,2,3,4,5]。
        assertEquals(listOf(1, 2, 3, 4, 5), order)
        assertNotEquals(listOf(1, 2, 4, 3, 5), order)
    }

    @Test
    fun `respects maxNodes cap and stops early`() {
        val tree = TestNode(1, listOf(TestNode(2), TestNode(3), TestNode(4)))

        val order = NodeTreeFlattener.flattenDfs(tree, maxNodes = 2) { it.children }.map { it.id }

        assertEquals(2, order.size)
    }

    @Test
    fun `single node with no children returns just itself`() {
        val order = NodeTreeFlattener.flattenDfs(TestNode(42), maxNodes = 100) { it.children }.map { it.id }
        assertEquals(listOf(42), order)
    }
}
