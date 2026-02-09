# 今日头条自动发布系统

## 概述

自动化今日头条（Toutiao）内容发布系统，支持 **三种内容类型**：

| 类型 | 状态 | 说明 |
|------|------|------|
| **文章** | ✅ 已完成 | 长图文内容，支持多图，已测试成功 |
| **微头条** | ✅ 已完成 | 短内容，类似微博，支持纯文本发布 |
| **视频** | ⏳ 待完成 | 视频内容 |

**开发优先级**：微头条 > 视频 > 文章（已完成）

## 系统架构

```
VPS (Linux)                          Windows (100.97.242.124)
  │                                       │
  ├─ 内容准备                            ├─ Chrome 浏览器 (:19225 CDP)
  ├─ 文件传输 (File Receiver :3001)     ├─ 今日头条网页端
  └─ CDP 控制脚本                        └─ 文件接收器
```

## 功能状态

| 功能 | 状态 | 说明 |
|------|------|------|
| **文章发布** | ✅ 完整实现 | 长图文，标题+内容+多图，已测试成功 |
| **微头条发布** | ✅ 完整实现 | 短内容，纯文本发布，已测试成功 |
| **视频发布** | ⏳ 待实现 | 视频上传+封面+描述 |
| **文件组织** | ✅ 完整实现 | 按日期/类型组织，使用北京时间 |
| **状态追踪** | ⏳ 待实现 | 发布成功/失败状态记录 |

## 核心脚本

### 1. 通用发布脚本
**文件**: `/tmp/toutiao-publish-universal.cjs`

**用法**:
```bash
# 准备配置文件
cat > /tmp/publish-config.json << 'EOF'
{
  "type": "image",
  "title": "测试标题",
  "content": "测试内容",
  "media": [
    "C:\\automation\\uploads\\image-1.jpg",
    "C:\\automation\\uploads\\image-2.jpg",
    "C:\\automation\\uploads\\image-3.jpg"
  ]
}
EOF

# 执行发布
node /tmp/toutiao-publish-universal.cjs /tmp/publish-config.json
```

**配置格式**:
```json
{
  "type": "article" | "micro" | "video",
  "title": "标题（2-30字，仅article需要）",
  "content": "正文内容",
  "media": ["文件绝对路径数组"],
  "options": {
    "topic": "#话题#",
    "location": "位置信息"
  }
}
```

**类型说明**：
- `article`: 文章（长图文，有标题）✅
- `micro`: 微头条（短内容，无标题）⏳
- `video`: 视频 ⏳

### 2. 文件上传脚本
**文件**: `/tmp/upload-to-desktop-organized.sh`

**功能**:
- 从VPS上传文件到Windows
- 自动创建日期文件夹
- 按类型分类（images/videos）
- 使用帖子标题命名

**文件结构**:
```
Desktop/
└── 2026-02-09/          # 北京时间日期
    ├── images/
    │   ├── 标题-1.jpg
    │   ├── 标题-2.jpg
    │   └── 标题-3.jpg
    └── videos/
        └── 标题-1.mp4
```

## 发布流程

### 文章发布流程 ✅

**入口**: `https://mp.toutiao.com/profile_v4/graphic/publish`

已验证成功的完整流程：

```
1. 进入编辑页面
   https://mp.toutiao.com/profile_v4/graphic/publish

2. 填写标题（使用 Input.insertText 触发 React 状态）
   textarea[placeholder*="请输入文章标题"]

3. 填写内容（ProseMirror 编辑器）
   .ProseMirror[contenteditable="true"]

4. 点击"预览并发布"
   等待5秒进入封面选择页

5. 选择封面类型（单图/三图）
   根据图片数量自动选择

6. 打开上传drawer
   点击 .article-cover-add

7. 上传图片
   drawer 中的 input[type="file"]
   使用 DOM.setFileInputFiles

8. 配置发布选项
   - 不投放广告
   - 其他默认设置

9. 点击发布
   滚动到底部 → 点击"发布"按钮

10. 处理确认弹窗（如有）
    点击"确认"按钮

11. 验证发布成功
    URL 跳转到 /graphic/articles
```

### 微头条发布流程 ✅

**入口**: `https://mp.toutiao.com/profile_v4/weitoutiao/publish`

**脚本**: `scripts/publish-weitoutiao.cjs`

已验证成功的完整流程（纯文本）：

```
1. 进入发布页面
   https://mp.toutiao.com/profile_v4/weitoutiao/publish

2. 填写内容（ProseMirror 编辑器）
   .ProseMirror[contenteditable="true"]
   使用 innerText 保留换行

3. 点击发布
   查找包含"发布"文本且可见的 button

4. 验证发布成功
   URL 跳转到 /profile_v4/weitoutiao（列表页）
```

**用法**:
```bash
# 准备配置文件
cat > /tmp/weitoutiao-config.json << 'EOF'
{
  "content": "这是一条微头条测试内容\n\n支持换行和emoji 🤖\n\n#话题标签 #测试"
}
EOF

# 执行发布
node scripts/publish-weitoutiao.cjs /tmp/weitoutiao-config.json

# 查看截图
ls /tmp/weitoutiao-publish-screenshots/
```

**特点**:
- ✅ 无需标题（微头条没有单独标题字段）
- ✅ 支持换行和emoji
- ✅ 支持hashtag话题标签（直接在内容中写 `#话题#`）
- ⚠️  图片上传功能待完善（需要进一步UI分析）

**发布成功标志**:
- URL从 `/weitoutiao/publish` 跳转到 `/weitoutiao`
- 在微头条列表页顶部看到新发布的内容

### 关键技术点

**1. React 受控输入**
```javascript
const textarea = document.querySelector('textarea[placeholder*="请输入文章标题"]');
const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value').set;
setter.call(textarea, value);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
```

**2. ProseMirror 编辑器**
```javascript
const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
editor.focus();
editor.innerHTML = '<p>' + content + '</p>';
editor.dispatchEvent(new Event('input', { bubbles: true }));
```

**3. Drawer 中的文件上传**
```javascript
// 1. 点击打开drawer
document.querySelector('.article-cover-add').click();

// 2. 等待drawer出现
await sleep(2000);

// 3. 查找file input
const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
  nodeId: root.nodeId,
  selector: 'input[type="file"]'
});

// 4. 设置文件
await cdp.send('DOM.setFileInputFiles', {
  nodeId: nodeIds[0],
  files: filePaths
});

// 5. 触发change事件
input.dispatchEvent(new Event('change', { bubbles: true }));
```

### 微头条发布流程 ⏳

**状态**: 重点待实现（用户要求）

**入口**: `https://mp.toutiao.com/profile_v4/weitoutiao/publish`（推测）

**预期流程**：
1. 导航到微头条发布页面
2. 填写内容（**无标题**，直接正文）
3. 上传图片（可选，可能也是drawer方式）
4. 添加话题标签（可选，如 `#AI应用#`）
5. 添加位置信息（可选）
6. 点击发布
7. 验证发布成功

**特点**：
- 类似微博的短内容形式
- 无标题字段，只有正文
- 支持话题标签和位置
- 发布流程应该比文章更简单

**待探索**：
- 确切的发布页面URL
- 内容输入框的选择器
- 图片上传方式（是否也是drawer）
- 话题标签如何添加
- 位置信息如何填写
- 发布按钮位置

### 视频发布流程 ⏳

**状态**: 重点待实现（用户要求）

**入口**: 待探索（可能是西瓜视频平台）

**预期流程**：
1. 导航到视频发布页面
2. 上传视频文件（可能需要更长等待时间）
3. 上传封面图或从视频截取
4. 填写标题和描述
5. 配置视频特定选项
6. 完成发布

**已知信息**:
- 视频内容可能通过"西瓜视频"平台发布
- 需要手动探索视频发布界面的URL和结构
- 实现方式应该类似文章发布

**待探索**：
1. 视频发布的确切URL
2. 视频上传按钮的位置
3. file input 的位置和 accept 属性
4. 是否有封面上传步骤
5. 发布选项的具体内容

## 文件传输

### File Receiver (Windows端)
- **端口**: 3001
- **上传目录**: `C:\automation\uploads\`
- **文件命名**: `<hash>-<原始名>.ext`

### 上传到Desktop
使用SSH通过Tailscale连接Windows，移动文件并重命名：

```bash
# 1. 上传到 uploads 目录（通过File Receiver）
curl -F "file=@image.jpg" http://100.97.242.124:3001/upload

# 2. 通过SSH移动到Desktop并重命名
ssh windows "move /Y 'C:\automation\uploads\*.jpg' 'C:\Users\Administrator\Desktop\2026-02-09\images\标题-1.jpg'"
```

## CDP 连接

- **目标**: Windows (100.97.242.124:19225)
- **网络**: Tailscale VPN
- **浏览器**: Chrome with `--remote-debugging-port=19225`

## 时间戳

所有文件夹使用 **北京时间** (Asia/Shanghai)：
```bash
TZ='Asia/Shanghai' date '+%Y-%m-%d'  # 2026-02-09
TZ='Asia/Shanghai' date '+%H:%M:%S'  # 17:50:00
```

## 测试

### 测试图文发布
```bash
# 1. 准备测试图片
# （假设已在VPS上）

# 2. 上传到Windows
bash /tmp/upload-to-desktop-organized.sh

# 3. 创建配置
cat > /tmp/test-image-config.json << 'EOF'
{
  "type": "image",
  "title": "自动化测试文章",
  "content": "这是一篇通过自动化脚本发布的测试文章。",
  "media": [
    "C:\\Users\\Administrator\\Desktop\\2026-02-09\\images\\自动化测试文章-1.jpg"
  ]
}
EOF

# 4. 执行发布
node /tmp/toutiao-publish-universal.cjs /tmp/test-image-config.json
```

## 截图

所有执行过程的截图保存在：
- 图文: `/tmp/publish-screenshots/`
- 视频: `/tmp/video-screenshots/`

## 下一步

1. **视频发布**
   - [ ] 手动探索视频发布UI
   - [ ] 记录URL和元素选择器
   - [ ] 实现自动化脚本
   - [ ] 测试完整流程

2. **增强功能**
   - [ ] 状态追踪（成功/失败/pending）
   - [ ] 队列管理（批量发布）
   - [ ] 错误重试机制
   - [ ] 发布历史记录

3. **与Cecelia集成**
   - [ ] 创建 `/toutiao-publisher` skill
   - [ ] Cecelia任务调度
   - [ ] 自动从内容库读取
   - [ ] 定时发布功能

## 技术栈

- **CDP (Chrome DevTools Protocol)**: 浏览器自动化
- **Node.js**: 脚本执行环境
- **WebSocket**: CDP通信
- **Bash**: 文件传输和组织
- **SSH**: Windows远程操作
- **Tailscale**: VPN网络

## 参考文件

- 通用脚本: `/tmp/toutiao-publish-universal.cjs`
- 成功案例: `/tmp/auto-publish-complete.cjs`
- 文件上传: `/tmp/upload-to-desktop-organized.sh`
- 调查结果: `/tmp/TOUTIAO-VIDEO-FINDINGS.md`

## 维护者

系统由 Claude Code (Opus 4.6) 开发和维护。

最后更新: 2026-02-09 17:56 (北京时间)
