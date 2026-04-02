# 抖音发布器 - 字段规范

**版本**: 2.0.0（基于实际代码分析）
**日期**: 2026-02-12
**数据来源**: Windows PC 上的三个 working 脚本

---

## 图文 (image)

```
type.txt        → "image"
content.txt     → 文案（可选，可以只发图片）
image.jpg       → 图片（必需，至少 1 张）
```

**目录结构**:
```
post-1/
├── type.txt
├── content.txt
└── image.jpg     （可以有多张：image1.jpg, image2.jpg, ...）
```

**代码字段** (`queueData`):
```json
{
  "content": "文案内容",
  "images": ["图片1路径", "图片2路径"]
}
```

---

## 视频 (video)

```
type.txt        → "video"
title.txt       → 标题（必需）
video.mp4       → 视频文件（必需）
```

**目录结构**:
```
post-2/
├── type.txt
├── title.txt
└── video.mp4
```

**代码字段** (`queueData`):
```json
{
  "title": "视频标题",
  "video": "视频文件路径"
}
```

**⚠️ 注意**: 视频上传需要 1-3 分钟，脚本会自动等待。

---

## 文章 (article)

```
type.txt        → "article"
title.txt       → 标题（必需）
summary.txt     → 摘要（可选，自动截取 content 前 30 字）
content.txt     → 正文（必需）
cover.jpg       → 封面（⚠️ 强烈推荐，无封面会失败）
```

**目录结构**:
```
post-3/
├── type.txt
├── title.txt
├── summary.txt   （可选）
├── content.txt
└── cover.jpg
```

**代码字段** (`queueData`):
```json
{
  "title": "文章标题",
  "summary": "文章摘要（可选）",
  "content": "文章正文",
  "cover": "封面图片路径"
}
```

**⚠️ 重要**: 虽然界面有"无文章头图"选项，但实际测试发现选择后会**静默失败**（返回上传页面）。**生产环境必须提供 cover 封面**。

---

## 对比总结

| 字段 | 图文 | 视频 | 文章 | 说明 |
|------|:----:|:----:|:----:|------|
| type | ✓ | ✓ | ✓ | 内容类型标识 |
| content | ○ | - | ✓ | 图文可选，文章必需 |
| title | - | ✓ | ✓ | 图文无 title 字段 |
| summary | - | - | ○ | 自动截取 content |
| image(s) | ✓ | - | - | 至少 1 张 |
| video | - | ✓ | - | - |
| cover | - | - | ⚠️ | 虽可选但必需 |

**图例**: ✓ 必需 | ○ 可选 | - 不存在 | ⚠️ 推荐必需

---

## 快速参考

```bash
# 图文（至少 1 张图）
type.txt + content.txt (可选) + image.jpg

# 视频
type.txt + title.txt + video.mp4

# 文章（必须有封面）
type.txt + title.txt + content.txt + cover.jpg + summary.txt (可选)
```

---

## 详细分析

完整的字段分析和代码引用请查看：`FIELDS.md`
