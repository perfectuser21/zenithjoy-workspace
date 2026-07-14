# 修复抓评论 UIA 节点误判 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复获客链 Seg3 抓评论把评论区元数据(标题栏"N条评论"、排序tab、日期、点赞数)误判成评论人昵称/正文的 bug。

**Architecture:** 两处改动都是纯逻辑修复：(1) `NodeExtractor.kt` 的结构启发式判据新增黑名单正则，拦住已知元数据形状；(2) 把 `DouyinCollectService.kt` 里评论树展开从 BFS 换成 DFS 前序遍历（抽成独立可单测的纯泛型函数 `NodeTreeFlattener.flattenDfs`），保证同一条评论内"昵称→正文"子节点在展开列表里保持相邻，这是 `extractByStructure` "相邻配对"假设成立的前提。

**Tech Stack:** Kotlin, JUnit（JVM 单测，无需 Robolectric/真机）

---

### Task 1: NodeExtractor 黑名单正则拦截元数据

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/NodeExtractor.kt:61-91`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/NodeExtractorTest.kt`

- [ ] **Step 1: 写 3 个 failing test（真机复现的 3 种误判样本）**

在 `NodeExtractorTest.kt` 里，紧跟在 `` `structural heuristic skips meta words like reply and time`() `` 测试之后（第 77 行后）插入：

```kotlin
    @Test
    fun `structural heuristic skips comment count title bar`() {
        val nodes = listOf(
            node(text = "7889条评论"),
            node(text = "最新"),
            node(text = "小赵"),
            node(text = "太贵了吧"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("小赵", result[0].commenterId)
        assertEquals("太贵了吧", result[0].text)
    }

    @Test
    fun `structural heuristic does not leak like-count into comment text or next nickname`() {
        val nodes = listOf(
            node(text = "小赵"),
            node(text = "太贵了吧"),
            node(text = "1.2万"),
            node(text = "小钱"),
            node(text = "确实贵"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(2, result.size)
        assertEquals("小赵", result[0].commenterId)
        assertEquals("太贵了吧", result[0].text)
        assertEquals("小钱", result[1].commenterId)
        assertEquals("确实贵", result[1].text)
    }

    @Test
    fun `structural heuristic does not mispair date with following real nickname`() {
        val nodes = listOf(
            node(text = "07-15"),
            node(text = "小孙"),
            node(text = "这个多少钱"),
        )
        val result = NodeExtractor.extractComments(nodes)
        assertEquals(1, result.size)
        assertEquals("小孙", result[0].commenterId)
        assertEquals("这个多少钱", result[0].text)
    }
```

- [ ] **Step 2: 运行测试，确认三个新用例失败**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.NodeExtractorTest"
```

预期：新增的 3 个测试 FAIL（旧的 8 个测试仍 PASS）。原因预期：
- `structural heuristic skips comment count title bar`：`"7889条评论"` 被误判为昵称候选，产出多余/错误 entry
- `structural heuristic does not leak like-count into comment text or next nickname`：`"1.2万"` 长度在 1~20 范围、不在 `META_WORDS`，会被当成下一条的"昵称"，导致 `"小钱"` 和 `"确实贵"` 配对错位或多产出一条脏数据，`result.size` 不等于 2
- `structural heuristic does not mispair date with following real nickname`：`"07-15"` 被误判为昵称，跟 `"小孙"` 错误配对成一条评论，`result.size` 不等于 1

- [ ] **Step 3: 实现黑名单正则拦截**

修改 `NodeExtractor.kt` 第 61-91 行（`META_WORDS` 声明到 `extractByStructure` 结尾），替换为：

```kotlin
    private val META_WORDS = setOf(
        "回复", "赞", "展开", "点赞", "更多回复",
        "热门", "最新", "查看更多回复", "展开更多回复", "IP属地",
    )
    private val NICKNAME_LEN_RANGE = 1..20
    private val CONTENT_MIN_LEN = 1

    // 数字/数字+单位（点赞数，如 "1.2万" "128" "3k"）
    private val LIKE_COUNT_RE = Regex("""^\d+(\.\d+)?[万kK]?\+?$""")
    // "7889条评论" / "共7889条评论"（评论区标题栏）
    private val COMMENT_COUNT_TITLE_RE = Regex("""^(共)?\d+条评论$""")
    // "07-15" / "2026-07-15"（日期）
    private val DATE_RE = Regex("""^\d{1,4}-\d{1,2}(-\d{1,2})?$""")
    // "N天/小时/分钟/秒前"（相对时间，已有逻辑）
    private val RELATIVE_TIME_RE = Regex("""^\d+[天小时分钟秒]前$""")
    // "IP属地: XX" / "IP属地：XX"
    private val IP_LOCATION_RE = Regex("""^IP属地[:：].*""")

    /** 判断一段 UIA 节点文本是不是已知的"评论区元数据"标签，而不是真实昵称/正文。 */
    private fun looksLikeMetaLabel(text: String): Boolean =
        text in META_WORDS ||
            LIKE_COUNT_RE.matches(text) ||
            COMMENT_COUNT_TITLE_RE.matches(text) ||
            DATE_RE.matches(text) ||
            RELATIVE_TIME_RE.matches(text) ||
            IP_LOCATION_RE.matches(text)

    private fun extractByStructure(nodes: List<NodeInfo>): List<CommentEntry> {
        val entries = mutableListOf<CommentEntry>()
        var i = 0
        while (i < nodes.size - 1) {
            val candidate = nodes[i]
            val nextText = nodes[i + 1]
            val nickname = candidate.text.trim()
            val content = nextText.text.trim()

            val looksLikeNickname = nickname.isNotBlank() &&
                nickname.length in NICKNAME_LEN_RANGE &&
                !nickname.contains("：") && !nickname.contains(":") &&
                !looksLikeMetaLabel(nickname)

            val looksLikeContent = content.length >= CONTENT_MIN_LEN &&
                !looksLikeMetaLabel(content)

            if (looksLikeNickname && looksLikeContent) {
                entries.add(CommentEntry(commenterId = nickname, text = content))
                i += 2
            } else {
                i += 1
            }
        }
        return entries
    }
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.NodeExtractorTest"
```

预期：全部 11 个测试 PASS（原 8 个 + 新增 3 个）。

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/NodeExtractor.kt \
        services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/NodeExtractorTest.kt
git commit -m "fix: NodeExtractor 黑名单拦截评论区元数据(标题栏/点赞数/日期/排序tab)误判为昵称"
```

---

### Task 2: 抽取可单测的 DFS 前序遍历纯函数

**Files:**
- Create: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattener.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattenerTest.kt`

**为什么单独抽出来**：`AccessibilityNodeInfo` 是 Android 框架类，这个 repo 的 unit test 没有 Robolectric/mockk（`build.gradle.kts` 里 `testImplementation` 只有 junit/mockwebserver/coroutines-test），没法直接对着真实 `AccessibilityNodeInfo` 树写 JVM 单测。把"给定一棵树，按 DFS 前序展开"抽成一个不依赖 Android 框架的泛型纯函数（用 `children: (T) -> List<T>` lambda 解耦具体节点类型），就能用普通 Kotlin 数据类搭一棵测试树验证遍历顺序，生产代码里再传入真实 `AccessibilityNodeInfo` 的 child 访问逻辑。

- [ ] **Step 1: 写 failing test**

创建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattenerTest.kt`：

```kotlin
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
```

- [ ] **Step 2: 运行测试，确认失败（类不存在）**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.NodeTreeFlattenerTest"
```

预期：编译失败，报 `Unresolved reference: NodeTreeFlattener`。

- [ ] **Step 3: 实现 NodeTreeFlattener**

创建 `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattener.kt`：

```kotlin
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
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest --tests "com.zenithjoy.agent.collect.NodeTreeFlattenerTest"
```

预期：4 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattener.kt \
        services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/NodeTreeFlattenerTest.kt
git commit -m "feat: 抽取可单测的DFS前序遍历纯函数NodeTreeFlattener"
```

---

### Task 3: DouyinCollectService.flattenNodes 改用 DFS

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt:980-999`

> 这一步没有独立 JVM test（`AccessibilityNodeInfo` 无法在纯 JVM 单测里构造真实树，Task 2 已经把可测的遍历逻辑单独验证过），是纯粹的"把生产代码接到已验证的纯函数"改动，风险极低。Task 1+2 的单测组合已经覆盖了"黑名单过滤"和"DFS 顺序正确"两点，这里只是接线。

- [ ] **Step 1: 替换 flattenNodes 实现**

把 `DouyinCollectService.kt` 第 980-999 行的 `flattenNodes` 函数：

```kotlin
    private fun flattenNodes(root: AccessibilityNodeInfo): List<NodeExtractor.NodeInfo> {
        // 真机复现：热门视频(1.1万条评论)的评论区节点树遍历会异常耗时/疑似卡死，
        // 加节点数上限防止在这类大树上无限期占用主线程(与 startExtractionWatchdog
        // 互为兜底：这里防真卡死，watchdog 防"卡住但没完全死"这类情况)。
        val result = mutableListOf<NodeExtractor.NodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < MAX_FLATTEN_NODES) {
            val node = queue.removeFirst()
            visited++
            result.add(NodeExtractor.NodeInfo(
                text = node.text?.toString() ?: "",
                contentDescription = node.contentDescription?.toString() ?: "",
                resourceId = node.viewIdResourceName ?: "",
            ))
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return result
    }
```

替换为：

```kotlin
    private fun flattenNodes(root: AccessibilityNodeInfo): List<NodeExtractor.NodeInfo> {
        // 真机复现：热门视频(1.1万条评论)的评论区节点树遍历会异常耗时/疑似卡死，
        // 加节点数上限防止在这类大树上无限期占用主线程(与 startExtractionWatchdog
        // 互为兜底：这里防真卡死，watchdog 防"卡住但没完全死"这类情况)。
        //
        // DFS 前序而非 BFS：同一条评论的"昵称→正文→元信息"是同一容器节点的连续
        // 子节点，BFS 按层展开会把它们和其他评论的同层节点交错，打乱
        // NodeExtractor.extractByStructure 依赖的"相邻文本配对"假设（见 NodeTreeFlattener 注释）。
        val accessibilityNodes = NodeTreeFlattener.flattenDfs(root, MAX_FLATTEN_NODES) { node ->
            (0 until node.childCount).mapNotNull { node.getChild(it) }
        }
        return accessibilityNodes.map { node ->
            NodeExtractor.NodeInfo(
                text = node.text?.toString() ?: "",
                contentDescription = node.contentDescription?.toString() ?: "",
                resourceId = node.viewIdResourceName ?: "",
            )
        }
    }
```

- [ ] **Step 2: 编译验证（无独立单测，靠编译 + 已有测试套件不回归）**

```bash
cd services/agent-android && ./gradlew :app:compileDebugKotlin
```

预期：编译成功，无报错。

- [ ] **Step 3: 跑全量单测确认无回归**

```bash
cd services/agent-android && ./gradlew :app:testDebugUnitTest
```

预期：全部测试 PASS（含 Task 1/2 新增的用例、`DouyinCollectServiceStateTest` 等既有测试）。

- [ ] **Step 4: Commit**

```bash
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt
git commit -m "fix: flattenNodes改用DFS前序遍历,保持评论item内部子节点相邻顺序"
```

---

## Plan 自检

- **Spec 覆盖**：spec 的"方案"两点——(1) NodeExtractor 黑名单正则 → Task 1；(2) flattenNodes BFS→DFS → Task 2+3。spec 的"测试计划"三条 regression case 逐条对应 Task 1 Step 1 的三个测试。bounds/几何锚点已在 spec 里明确收窄不做。
- **占位符扫描**：无 TBD/TODO，每个 Step 都有完整代码块和期望输出。
- **类型一致性**：`NodeExtractor.NodeInfo(text, contentDescription, resourceId)` 构造签名在 Task 1/3 里保持一致；`NodeTreeFlattener.flattenDfs<T>(root: T, maxNodes: Int, children: (T) -> List<T>)` 在 Task 2 定义、Task 3 调用签名一致。
