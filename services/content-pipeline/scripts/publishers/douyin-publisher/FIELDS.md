# 抖音发布字段分析（根据实际代码）

**分析时间**: 2026-02-12
**数据来源**: Windows PC 上的三个 working 脚本

---

## 1. 图文（Image/Text Posts）

**脚本**: `publish-douyin-image.js`

### 使用的字段

```json
{
  "content": "文案内容",
  "images": ["图片1路径", "图片2路径", ...]
}
```

### 实际使用位置

| 字段 | 代码位置 | 输入方式 | 说明 |
|------|---------|---------|------|
| `content` | 行 78-80 | `keyboard.type()` | 填写到 `[contenteditable="true"]` 元素 |
| `images` | 行 62-67 | `setInputFiles()` | 上传到 `input[type="file"]` 文件选择器 |

### 字段是否必需

- **content**: 可选（可以只发图片）
- **images**: 必需（至少 1 张，否则抛出错误 "没有图片文件"）

---

## 2. 视频（Video）

**脚本**: `publish-douyin-video.js`

### 使用的字段

```json
{
  "title": "视频标题",
  "video": "视频文件路径"
}
```

### 实际使用位置

| 字段 | 代码位置 | 输入方式 | 说明 |
|------|---------|---------|------|
| `title` | 行 82 | `fill()` | 填写到 `input[placeholder*="标题"]` 输入框 |
| `video` | 行 67 | `setInputFiles()` | 上传到 `input[type="file"]` 文件选择器 |

### 字段是否必需

- **title**: 必需（视频上传后必须填写标题）
- **video**: 必需（没有视频无法发布）

---

## 3. 文章（Article）

**脚本**: `publish-douyin-article.js`

### 使用的字段

```json
{
  "title": "文章标题",
  "summary": "文章摘要（可选）",
  "content": "文章正文",
  "cover": "封面图片路径（可选）"
}
```

### 实际使用位置

| 字段 | 代码位置 | 输入方式 | 说明 |
|------|---------|---------|------|
| `title` | 行 64 | `fill()` | 填写到 `input[placeholder*="文章标题"]` |
| `summary` | 行 71-74 | `fill()` | 填写到 `input[placeholder*="摘要"]`，如果没有则用 `content` 前 30 字 |
| `content` | 行 82-89 | `evaluate()` | 直接设置到 `[contenteditable="true"]` 元素 |
| `cover` | 行 96-128 | `filechooser.setFiles()` | 有封面 → 上传；无封面 → 选择"无文章头图" |

### 字段是否必需

- **title**: 必需
- **summary**: 可选（自动截取 content 前 30 字）
- **content**: 必需
- **cover**: 可选（但如果选择"无文章头图"可能导致发布失败⚠️）

### 特别注意

**文章封面处理逻辑**（行 96-128）:

```javascript
if (queueData.cover && fs.existsSync(queueData.cover)) {
  // 有封面 → 上传
  选择"有文章头图" → 上传文件 → 关闭弹窗
} else {
  // 无封面 → 选择"无文章头图"
  // ⚠️ 用户反馈：选择"无文章头图"会导致发布失败
}
```

**重要发现**（来自用户反馈）：
- 虽然界面有"无文章头图"选项，但选择后发布会**静默失败**（返回上传页面）
- **实际使用中 cover 是必需的**

---

## 对比总结

| 类型 | 字段数 | 必需字段 | 可选字段 | 特殊说明 |
|------|--------|---------|---------|---------|
| **图文** | 2 | images | content | 至少 1 张图片 |
| **视频** | 2 | title, video | - | 视频上传需 1-3 分钟 |
| **文章** | 4 | title, content, cover | summary | cover 虽可选但推荐必填 |

---

## 发布 API

**所有三种类型使用同一个 API**:

```
POST /web/api/media/aweme/create_v2/
```

**成功响应**:

```json
{
  "status_code": 0,
  "item_id": "7605837846758313266"  // 或 "ItemId" 或 "aweme_id"
}
```

---

**结论**：三个脚本已验证可用，字段要求明确，可直接用于生产。
