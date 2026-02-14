# Publisher Workflow - 内容发布

> 自动化内容发布工具（支持今日头条）

## 功能说明

自动将内容发布到社交媒体平台：
- 图文内容发布
- 视频内容发布
- 队列管理
- 批量发布
- 状态追踪

## 支持的平台

| 平台 | 内容类型 | 状态 |
|------|---------|------|
| 今日头条 | 图文、视频 | ✅ 已实现 |

## 使用方式

### 通过 Feature Skill

```bash
# 发布到今日头条（默认）
/platform-data publish

# 指定发布队列日期
/platform-data publish --queue 2026-02-10

# 批量发布模式
/platform-data publish --batch
```

### 直接调用

```bash
node apps/features/platform-data/workflows/publisher/scripts/publish.js
```

## 发布流程

### 1. 内容准备

将内容组织到发布队列：
```
~/.toutiao-queue/
├── 2026-02-10/
│   ├── post-001/
│   │   ├── title.txt
│   │   ├── content.txt
│   │   └── images/
│   │       ├── 1.jpg
│   │       └── 2.jpg
│   └── post-002/
│       └── ...
```

### 2. 文件传输

通过 rsync 同步到 Windows 发布机：
```bash
rsync -avz ~/.toutiao-queue/ user@windows:/target/
```

### 3. 自动发布

使用 Chrome DevTools Protocol 自动化：
1. 登录平台
2. 填写标题和内容
3. 上传图片/视频
4. 配置发布选项
5. 点击发布
6. 验证发布成功

### 4. 状态追踪

记录发布状态到数据库：
```json
{
  "id": "post-001",
  "status": "published",
  "published_at": "2026-02-10T10:30:00Z",
  "platform": "toutiao",
  "url": "https://..."
}
```

## 配置

### 发布机器

- **系统**: Windows (Windows PC)
- **IP**: 100.97.242.124 (Tailscale)
- **CDP**: 19225
- **队列**: `C:\Users\Administrator\Desktop\toutiao-media\`

### 今日头条配置

```javascript
{
  "platform": "toutiao",
  "url": "https://mp.toutiao.com/",
  "cdp_port": 19225,
  "title_min_length": 2,
  "title_max_length": 30
}
```

## 技术栈

- **浏览器自动化**: Chrome DevTools Protocol (CDP)
- **文件传输**: rsync
- **状态管理**: SQLite / JSON
- **运行时**: Node.js 18+

## 故障排查

### 连接失败

检查 Windows 发布机是否在线：
```bash
ping 100.97.242.124
```

### 文件传输失败

检查 rsync 配置：
```bash
rsync --dry-run -avz ~/.toutiao-queue/ user@100.97.242.124:/target/
```

### 发布失败

查看日志：
```bash
tail -f /tmp/publisher-toutiao.log
```

## 扩展计划

- [ ] 支持更多平台（抖音、快手、小红书）
- [ ] 定时发布功能
- [ ] 批量编辑工具
- [ ] 发布数据分析

## 相关文档

- [Feature 总览](../../README.md)
- [数据采集 Workflow](../scraper/README.md)
- [数据分析 Workflow](../analyzer/README.md)
- [Toutiao Publisher Skill](~/.claude/skills/toutiao-publisher/SKILL.md)
