---
name: douyin-publisher
description: 抖音自动发布工具 - 图文/视频/文章三种类型（生产就绪）
trigger: 发布抖音、douyin、抖音发布
version: 1.0.0
created: 2026-02-12
updated: 2026-02-12
changelog:
  - 1.0.0: ✅ 2026-02-12 完成 - 三种类型全部验证通过
---

# Douyin Publisher

抖音自动发布工具 - 完全自动化，零 AI 干预

## ✅ 验证通过（2026-02-12）

| 类型 | 耗时 | 最新测试 | 说明 |
|------|------|----------|------|
| **图文** | ~30s | item_id: 7605837846758313266 | 支持多图 |
| **视频** | ~90s | ItemId: 7605861760767233306 | 自动上传视频 |
| **文章** | ~60s | "完整流程测试 160245" | 必须有封面 |

**统计**: 成功 3 | 失败 0

---

## 🏗️ 架构

```
NAS 存储
    ↓ 扫描日期目录
Mac mini 调度器 (~/scheduler.sh)
    ↓ Base64 传输 + scp 文件
Windows PC Playwright (100.97.242.124)
    ↓ 自动化发布
抖音 ✅
```

**关键路径**：
- 美国 VPS → ssh mac-mini → ssh 100.97.242.124 (windows)
- Mac mini SSH 密钥：~/.ssh/windows_ed（ED25519）
- Windows 用户：xuxia（管理员）

---

## 📝 Windows PC 脚本位置

**所有脚本都在 Windows PC**: C:\Users\xuxia\playwright-recorder\

| 脚本 | 大小 | 最后更新 | 状态 |
|------|------|----------|------|
| publish-douyin-image.js | 4.3 KB | 2026-02-12 12:55 | ✅ 生产可用 |
| publish-douyin-video.js | 3.7 KB | 2026-02-12 14:23 | ✅ 生产可用 |
| publish-douyin-article.js | 5.8 KB | 2026-02-12 16:06 | ✅ 生产可用 |

---

## 📦 字段规范

### 图文（Image/Text）
```
content: 文案（可选）
images: 图片数组（至少 1 张）
```

### 视频（Video）
```
title: 标题
video: 视频文件路径
```

### 文章（Article）
```
title: 标题
summary: 摘要（可选）
content: 正文
cover: 封面路径（⚠️ 必需）
```

**完整字段说明**: 见 REQUIREMENTS.md 和 FIELDS.md

---

## 🎯 使用方式

### 方式 1：通过 Mac mini 调度器（推荐）

```bash
# 发布指定日期的内容
ssh mac-mini 'bash ~/scheduler.sh 2026-02-15'

# 发布今天的内容
ssh mac-mini 'bash ~/scheduler.sh'
```

### 方式 2：直接调用（开发/测试）

通过 Mac mini 中转到 Windows，创建 queue.json 并调用对应脚本。

---

## 🔧 关键技术

1. **CDP 连接** - chromium.connectOverCDP 连接已打开的浏览器
2. **API 监听** - 监听 /web/api/media/aweme/create_v2/ 判断成功
3. **文件上传** - setInputFiles() 上传图片/视频
4. **Filechooser** - 文章封面上传用 waitForEvent('filechooser')
5. **URL 跳转判断** - 跳转到 /content/manage 表示成功

---

## ⚠️ 重要教训

### 文章封面是必需的

虽然界面有"无文章头图"选项，但选择后会**静默失败**（返回上传页面）。

**原因**：平台要求文章必须有封面，选择"无封面"会被拒绝。

**解决方案**：生产环境必须提供 cover.jpg

---

## 📊 发布 API

**统一 API**（三种类型共用）:
```
POST /web/api/media/aweme/create_v2/
```

**成功响应**:
```
{
  "status_code": 0,
  "item_id": "7605837846758313266"
}
```

---

## 📚 文档

- REQUIREMENTS.md - 字段规范（NAS 目录结构）
- FIELDS.md - 字段详细分析（代码行号引用）
- STATUS.md - 完成状态和验证结果

---

**版本**: 1.0.0
**状态**: ✅ **生产就绪** - 图文/视频/文章三种类型完整验证通过
**架构**: NAS → Mac mini 调度器 → Windows PC → 抖音
**清理状态**: ✅ 所有临时文件已清理，只保留最终脚本
**完整性**: ✅ 端到端自动化，零人工干预

**使用**: ssh mac-mini 'bash ~/scheduler.sh YYYY-MM-DD'
