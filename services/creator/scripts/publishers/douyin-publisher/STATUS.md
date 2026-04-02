# Douyin Publisher - 状态报告

**最后更新**: 2026-02-12 16:02 ✅ **全部完成**

## ✅ 完成状态（三种类型全部打通）

### 图文发布 ✅
- **脚本**: `publish-douyin-image.js`
- **测试状态**: 成功
- **item_id**: 7605837846758313266
- **功能**: 标题 + 内容 + 图片（可选）

### 视频发布 ✅  
- **脚本**: `publish-douyin-video.js`
- **测试状态**: 成功
- **ItemId**: 7605861760767233306
- **功能**: 标题 + 视频文件

### 文章发布 ✅ **（2026-02-12 最终突破）**
- **脚本**: `publish-douyin-article.js`
- **测试状态**: ✅ **成功**
- **最新测试**: "完整流程测试 160245" - **1秒跳转到内容管理页面**
- **功能**: 标题 + 摘要 + 正文 + **封面（必需）**

## 关键技术突破

### 文章发布的核心要点

1. **封面图是必需的** ⚠️
   - 抖音文章必须上传封面头图才能发布
   - 选择"无文章头图"会导致发布失败（静默返回上传页面）
   - 使用 filechooser 模式上传

2. **发布按钮 XPath**
   - 不能用简单的 `button:has-text("发布")`
   - 必须使用准确的 XPath：
   ```javascript
   page.locator('xpath=/html/body/div[1]/div[1]/div/div[3]/div/div/div/div[2]/div/div/div/div/div[1]/div/div[3]/div/div/div/div/div/button[1]')
   ```

3. **内容填充方式**
   - 使用 `page.keyboard.type()` 模拟真实打字
   - 等待时间：封面上传后等待 5 秒，关闭弹窗后等待 3 秒

4. **成功标志**
   - URL 跳转到 `/content/manage`（通常 1-2 秒内完成）
   - 用户可在内容管理页面看到发布的文章

### 完整发布流程

```javascript
1. 导航到发布页面
2. 点击"我要发文"
3. 填写标题（必需）
4. 填写摘要（必需）
5. 填写正文（keyboard.type）
6. 上传封面头图（必需）：
   - 选择"有文章头图"
   - filechooser 上传
   - 等待 5 秒
   - 关闭"完成"弹窗
   - 等待 3 秒
7. 选择"立即发布"
8. 选择"公开"
9. 点击发布（使用 XPath）
10. 等待跳转到内容管理页面
```

## 架构

```
NAS 存储
    ↓
Mac mini 调度器 (~/scheduler.sh)
    ↓ Base64 传输 + scp 文件
Windows PC Playwright
    ↓ 自动化发布
抖音 ✅ （图文 + 视频 + 文章）
```

## 脚本位置

**Windows PC** (`C:\Users\xuxia\playwright-recorder\`):
- ✅ `publish-douyin-image.js` (4.2KB)
- ✅ `publish-douyin-video.js` (3.6KB)
- ✅ `publish-douyin-article.js` (5.7KB) ← **最终工作版本**

**Skills 备份**: `~/.claude/skills/douyin-publisher/scripts/`

## NAS 内容组织（待实现）

```
creator/output/douyin/
└── YYYY-MM-DD/
    ├── image-1/
    │   ├── type.txt         # "image"
    │   ├── title.txt
    │   ├── content.txt
    │   └── image.jpg        # 可选
    ├── video-1/
    │   ├── type.txt         # "video"
    │   ├── title.txt
    │   └── video.mp4
    └── article-1/
        ├── type.txt         # "article"
        ├── title.txt
        ├── summary.txt      # 摘要
        ├── content.txt
        └── cover.jpg        # ⚠️ 必需！
```

## 下一步

- [ ] 更新 Mac mini 调度器支持文章（带封面）
- [ ] 端到端测试三种类型
- [ ] 清理临时测试文件
- [ ] 与今日头条 publisher 统一架构

## 教训总结

1. **不要假设可选字段** - 封面看起来可选，实际是必需的
2. **XPath 比文本选择器更可靠** - 动态页面需要精确定位
3. **耐心等待上传完成** - 文件上传需要足够的等待时间
4. **URL 跳转是最可靠的成功标志** - API 监听不如 URL 变化可靠
