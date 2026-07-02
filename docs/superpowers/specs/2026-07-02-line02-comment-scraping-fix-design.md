# Line02 评论文本抓取修复 — 设计文档

**日期**：2026-07-02  
**Journey**：客户智能获客路径（Line 02）  
**类型**：Bug Fix（Path A）

---

## 根因链

```
crawl-comments-douyin.cjs
  └── 只抓 {sec_uid, nickname}，从不读 DOM 评论文字
        ↓
index.ts:1202
  └── 类型声明无 comment_text 字段
        ↓
index.ts:1207
  └── text: c.nickname || ''  （错误赋值）
        ↓
acquisition_leads.comment_text = null（全表）
```

Bug 3 独立：`searchDouyinVideosByKeyword(kw)` 调用时未传 options，task payload 类型缺 `max_videos_per_keyword`。

---

## 修改范围

### Bug 2：crawl-comments-douyin.cjs

**位置**：`services/agent/publishers/crawl-comments-douyin.cjs` 第 116-126 行

**改动**：在评论项循环中加评论文本抓取：

```js
// 选择器按优先级，catch 兜底空字符串
const commentText = await item.$eval(
  '[data-e2e="comment-item-content"], [class*="CommentContent"], [class*="comment-content"]',
  el => el.textContent?.trim() || ''
).catch(() => '');

commenters.push({ sec_uid: secUid, nickname, comment_text: commentText });
```

### Bug 1：index.ts 映射

**位置**：`services/agent/src/index.ts` 第 1202-1207 行

**改动**：
- 类型加 `comment_text?: string`
- `text: c.nickname || ''` → `text: c.comment_text || ''`

### Bug 3：maxVideosPerKeyword 可配

**位置**：`services/agent/src/index.ts` 第 1154 + 1168 行

**改动**：
- task 类型加 `max_videos_per_keyword?: number`
- 调用改为 `searchDouyinVideosByKeyword(kw, { maxVideosPerKeyword: task.max_videos_per_keyword ?? 5 })`

---

## 测试策略

| 层级 | 文件 | 覆盖内容 |
|------|------|----------|
| unit | `services/agent/src/__tests__/comment-mapping.test.ts` | rawCommenters 有 comment_text → text 正确；无 comment_text → text 为空字符串不崩溃 |
| 真机 | xian-pc 手动触发采集 | `acquisition_leads.comment_text` 有真实留言文字 |

CI 覆盖 unit test；真机验证是 DoD 条件不进 CI。

---

## 验收标准

- [ ] commit-1：failing unit test（验证映射逻辑）
- [ ] commit-2：三处代码修复让 test 变绿
- [ ] `max_videos_per_keyword` 可通过 task payload 覆盖（默认 5）
- [ ] CI 全绿
- [ ] 真机采集后 `comment_text` 有内容（xian-pc 验证）
