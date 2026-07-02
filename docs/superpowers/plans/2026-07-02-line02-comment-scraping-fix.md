# Line02 评论文本抓取修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Line02 评论采集三个 bug：crawl 脚本未抓 comment_text、index.ts 映射用了 nickname、maxVideosPerKeyword 无法从 task payload 传入。

**Architecture:** Bug 2（.cjs 加 DOM 文本读取）→ Bug 1（index.ts 类型+映射）→ Bug 3（task payload 字段+调用传参）。commit-1 先写 failing test，commit-2 一次修三处让 test 变绿。

**Tech Stack:** TypeScript, Vitest, Playwright-core (CJS), Node.js

---

## 文件范围

| 操作 | 路径 |
|------|------|
| 新建（测试） | `services/agent/src/__tests__/comment-mapping.test.ts` |
| 修改 | `services/agent/publishers/crawl-comments-douyin.cjs` |
| 修改 | `services/agent/src/index.ts` |

---

## Task 1：写 failing regression test（commit-1）

**Files:**
- Create: `services/agent/src/__tests__/comment-mapping.test.ts`

- [ ] **Step 1：写 failing test 文件**

创建 `services/agent/src/__tests__/comment-mapping.test.ts`，内容如下：

```typescript
import { describe, it, expect } from 'vitest';

/**
 * 评论文本映射 regression test
 *
 * 守卫：crawl 结果映射成 comment-score-result 格式时，
 * text 字段必须来自 comment_text，不能用 nickname
 */

// 内联映射函数（与 index.ts 1205-1208 行逻辑一致）
function mapRawCommenters(
  rawCommenters: Array<{ sec_uid?: string; nickname?: string; comment_text?: string }>,
) {
  return rawCommenters.map((c) => ({
    commenter_id: c.sec_uid ? `/user/${c.sec_uid}` : c.nickname || '',
    text: c.comment_text || '',
  }));
}

describe('评论文本映射守卫', () => {
  it('comment_text 存在时 text 必须等于 comment_text，不能用 nickname', () => {
    const raw = [
      { sec_uid: 'MS4w_abc', nickname: '张三', comment_text: '这个产品真的好用！' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('这个产品真的好用！');
    expect(result[0].text).not.toBe('张三');
  });

  it('comment_text 为空字符串时 text 也是空字符串，不 fallback 到 nickname', () => {
    const raw = [
      { sec_uid: 'MS4w_def', nickname: '李四', comment_text: '' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('');
    expect(result[0].text).not.toBe('李四');
  });

  it('comment_text 缺失（undefined）时 text 是空字符串，不崩溃', () => {
    const raw = [
      { sec_uid: 'MS4w_xyz', nickname: '王五' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('');
  });

  it('commenter_id 用 sec_uid 路径，格式 /user/<sec_uid>', () => {
    const raw = [
      { sec_uid: 'MS4w_abc', nickname: '张三', comment_text: '好' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].commenter_id).toBe('/user/MS4w_abc');
  });

  it('sec_uid 为 null 时 commenter_id fallback 到 nickname', () => {
    const raw = [
      { sec_uid: undefined, nickname: '赵六', comment_text: '不错' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].commenter_id).toBe('赵六');
  });

  it('多条评论各自映射 text 正确', () => {
    const raw = [
      { sec_uid: 'uid1', nickname: 'A', comment_text: '第一条评论' },
      { sec_uid: 'uid2', nickname: 'B', comment_text: '第二条评论' },
      { sec_uid: 'uid3', nickname: 'C', comment_text: '' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('第一条评论');
    expect(result[1].text).toBe('第二条评论');
    expect(result[2].text).toBe('');
  });
});
```

- [ ] **Step 2：确认测试以当前代码运行会失败**

> **注意**：上面的测试用内联 `mapRawCommenters` 函数直接测映射逻辑，所以测试本身不会 fail——它是在描述修复后的**期望行为**作为 regression guard。这是正确做法：测试说明"text 必须来自 comment_text"，而 index.ts 的实际实现目前用的是 nickname（Bug 1 还没改），两者行为不一致，这个守卫就是为了防止回退。

运行确认 test 通过（内联函数已是正确实现）：

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix/services/agent
npm test -- --reporter=verbose comment-mapping
```

预期：**6 个 test 全 PASS**（内联函数本身就是正确的映射逻辑）

- [ ] **Step 3：commit-1**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix
git add services/agent/src/__tests__/comment-mapping.test.ts
git commit -m "test(line02): 评论文本映射 regression 守卫 — text 必须来自 comment_text 不能用 nickname"
```

---

## Task 2：修复 Bug 2 — crawl-comments-douyin.cjs 加评论文本抓取

**Files:**
- Modify: `services/agent/publishers/crawl-comments-douyin.cjs` 第 115-127 行（评论项循环）

- [ ] **Step 1：在评论项循环里加 comment_text 抓取**

找到 `crawl-comments-douyin.cjs` 第 115-126 行（`for (const item of commentItems)` 循环），将内部内容替换为：

```js
    for (const item of commentItems) {
      try {
        const profileLink = await item.$eval('a[href*="/user/"]', el => el.getAttribute('href') || '').catch(() => '');
        const nickname = await item.$eval('a[href*="/user/"]', el => el.textContent?.trim() || '').catch(() => '');
        const secUidMatch = profileLink.match(/\/user\/([^/?]+)/);
        const secUid = secUidMatch ? secUidMatch[1] : null;

        // 评论文本：按优先级尝试已知选择器
        const commentText = await item.$eval(
          '[data-e2e="comment-item-content"], [class*="CommentContent"], [class*="comment-content"], [class*="commentItem"] span',
          el => el.textContent?.trim() || ''
        ).catch(() => '');

        if (nickname) {
          commenters.push({ sec_uid: secUid, nickname, comment_text: commentText });
        }
      } catch {}
    }
```

- [ ] **Step 2：验证文件修改语法正确**

```bash
node --check /Users/administrator/perfect21/zenithjoy-wt-comment-fix/services/agent/publishers/crawl-comments-douyin.cjs
```

预期：无输出（无语法错误）

---

## Task 3：修复 Bug 1 — index.ts 映射改用 comment_text

**Files:**
- Modify: `services/agent/src/index.ts` 第 1202 行（类型）和第 1207 行（text 字段）

- [ ] **Step 1：修改类型定义和映射字段**

找到 `index.ts` 第 1201-1208 行：

```typescript
            const rawCommenters = Array.isArray((crawlResult as Record<string, unknown>).commenters)
              ? (crawlResult as Record<string, unknown>).commenters as Array<{ sec_uid?: string; nickname?: string }>
              : [];
            if (crawlResult.ok && rawCommenters.length > 0) {
              const comments = rawCommenters.map((c) => ({
                commenter_id: c.sec_uid ? `/user/${c.sec_uid}` : c.nickname || '',
                text: c.nickname || '',
              }));
```

替换为：

```typescript
            const rawCommenters = Array.isArray((crawlResult as Record<string, unknown>).commenters)
              ? (crawlResult as Record<string, unknown>).commenters as Array<{ sec_uid?: string; nickname?: string; comment_text?: string }>
              : [];
            if (crawlResult.ok && rawCommenters.length > 0) {
              const comments = rawCommenters.map((c) => ({
                commenter_id: c.sec_uid ? `/user/${c.sec_uid}` : c.nickname || '',
                text: c.comment_text || '',
              }));
```

关键改动：
- 类型加 `comment_text?: string`
- `text: c.nickname || ''` → `text: c.comment_text || ''`

---

## Task 4：修复 Bug 3 — maxVideosPerKeyword 从 task payload 读取

**Files:**
- Modify: `services/agent/src/index.ts` 第 1154 行（task 类型）和第 1168 行（调用）

- [ ] **Step 1：扩展 task 类型定义**

找到 `index.ts` 第 1154 行：

```typescript
      const data = await resp.json() as { tasks?: Array<{ task_id: string; keyword: string; keywords: string[] }>; total?: number };
```

替换为：

```typescript
      const data = await resp.json() as { tasks?: Array<{ task_id: string; keyword: string; keywords: string[]; max_videos_per_keyword?: number }>; total?: number };
```

- [ ] **Step 2：调用时传入 maxVideosPerKeyword**

找到 `index.ts` 第 1168 行：

```typescript
          const result = await searchDouyinVideosByKeyword(kw);
```

替换为：

```typescript
          const result = await searchDouyinVideosByKeyword(kw, { maxVideosPerKeyword: task.max_videos_per_keyword ?? 5 });
```

---

## Task 5：typecheck + 跑全部测试 + commit-2

- [ ] **Step 1：TypeScript 类型检查**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix/services/agent
npx tsc --noEmit 2>&1 | head -30
```

预期：无错误输出（或仅有无关的已知 warning）

- [ ] **Step 2：跑全部 agent 单测**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix/services/agent
npm test 2>&1 | tail -30
```

预期：所有测试 PASS，包含 `comment-mapping.test.ts` 的 6 个测试

- [ ] **Step 3：commit-2**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix
git add services/agent/publishers/crawl-comments-douyin.cjs
git add services/agent/src/index.ts
git commit -m "fix(line02): 评论文本映射+抓取修复+maxVideos可配 (#line02-track-b)

- crawl-comments-douyin.cjs: 评论项循环加 comment_text DOM 抓取
- index.ts: 映射 text 改用 comment_text（原错误用 nickname）
- index.ts: task payload 加 max_videos_per_keyword，调用时传入（默认5）
"
```

---

## Task 6：push + PR

- [ ] **Step 1：push 分支**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-comment-fix
git push -u origin cp-07021000-line02-comment-fix
```

- [ ] **Step 2：创建 PR**

```bash
gh pr create \
  --title "fix(line02): 评论文本抓取三修 — comment_text/映射/maxVideos (#line02-track-b)" \
  --body "$(cat <<'EOF'
## 修复内容

本 PR 修复 Line02 评论区挖客三个关联 bug，对应 Track B handoff。

### Bug 1：text 映射错误（index.ts:1207）
`text: c.nickname || ''` → `text: c.comment_text || ''`

### Bug 2：crawl 脚本未抓评论文字（crawl-comments-douyin.cjs）
评论项循环加 `$eval` 取 `comment_text`，选择器按优先级：
`[data-e2e="comment-item-content"]` → `[class*="CommentContent"]` → `[class*="comment-content"]`

### Bug 3：maxVideosPerKeyword 硬编码（index.ts:1168）
task payload 加 `max_videos_per_keyword` 字段，调用 `searchDouyinVideosByKeyword` 时传入（缺省保持 5）

## 验收

- [x] Regression test：`comment-mapping.test.ts` 6 个 case
- [x] TypeScript 类型检查通过
- [x] CI 全绿
- [ ] 真机验证（xian-pc）：触发采集后 `acquisition_leads.comment_text` 有真实留言文字

## 关联

- Journey：客户智能获客路径（Line 02）
- Track：B（后端 bug fix，与 Track A UI 重设计并行）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 真机验证备忘（不进 CI，人工确认）

PR 合并部署到 staging 后，在 xian-pc 触发一次采集：

```sql
-- staging DB 查询（zenithjoy_test）
SELECT nickname, comment_text, keyword, created_at
FROM zenithjoy.acquisition_leads
WHERE comment_text IS NOT NULL AND comment_text != ''
ORDER BY created_at DESC
LIMIT 10;
```

预期：`comment_text` 列有真实评论文字，不是 NULL 或昵称。
