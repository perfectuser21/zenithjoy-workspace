---
name: toutiao-publisher
description: 今日头条自动发帖工具，通过 node PC 浏览器全自动发布内容
trigger: 当需要发布内容到今日头条时，用户说"发到今日头条"、"发布到头条"
version: 2.0.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 2.0.0: 支持全自动发布（自动点击发布按钮）
  - 1.0.0: 初始版本，支持标题+正文+配图自动填充
---

# 今日头条自动发帖 Skill

**一键发布内容到今日头条小号**，全自动完成：填充标题、正文、上传配图、点击发布。

## 一句话使用

```bash
python3 scripts/publish-to-toutiao.py "标题" "正文" "配图.png"
```

就这么简单！脚本会自动：
1. 连接 node PC 浏览器（通过 Tailscale）
2. 打开今日头条发布页面
3. 填写标题和正文
4. 上传配图
5. 点击发布按钮

**无需手动操作，全程自动化！**

---

## 工作原理

1. **连接 node PC 浏览器**：通过 Tailscale 连接到 node PC (100.97.242.124)
2. **访问 Chrome DevTools**：端口 19226（今日头条小号）
3. **自动填充内容**：标题、正文、配图
4. **手动确认发布**：用户检查后手动点击发布按钮

## 快速开始

### 单篇发布（最简单）

```bash
python3 scripts/publish-to-toutiao.py "标题" "正文内容" "配图.png"
```

**示例**：
```bash
python3 scripts/publish-to-toutiao.py \
  "别把存档当成学会" \
  "你的收藏夹里躺着几十篇干货，除了点击收藏的那一秒，你再也没打开过它们..." \
  "output/deep-post-cards/01_别把存档当成学会.png"
```

**输出**：
```
连接到今日头条...
打开发布页面...
填写标题: 别把存档当成学会
填写正文...
上传配图: output/deep-post-cards/01_别把存档当成学会.png
点击发布按钮...
✓ 发布成功！
  标题: 别把存档当成学会
  正文长度: 159 字
  配图: output/deep-post-cards/01_别把存档当成学会.png
```

### 批量发布（多篇内容）

```bash
# 发布 3 篇，每篇间隔 5 秒
python3 scripts/publish-to-toutiao.py "标题1" "正文1" "图1.png" && sleep 5 && \
python3 scripts/publish-to-toutiao.py "标题2" "正文2" "图2.png" && sleep 5 && \
python3 scripts/publish-to-toutiao.py "标题3" "正文3" "图3.png"
```

### 前置条件

在使用前，请确保：

1. ✅ **node PC 在线**
   ```bash
   tailscale status | grep node
   # 应显示: 100.97.242.124  node  zenithjoy21xx@  windows  -
   ```

2. ✅ **浏览器端口开启**
   ```bash
   curl -s http://100.97.242.124:19226/json | head -5
   # 应返回 JSON 数据
   ```

3. ✅ **今日头条已登录**
   ```bash
   curl -s http://100.97.242.124:19226/json | grep "mp.toutiao.com"
   # 应找到今日头条页面
   ```

## 脚本位置

- **主脚本**: `scripts/publish-to-toutiao.py`
- **依赖**: websockets, requests

## 技术架构

### 浏览器连接

| 平台 | Host | 端口 | 说明 |
|------|------|------|------|
| 今日头条小号 | 100.97.242.124 | 19226 | node PC via Tailscale |

### 工作流程

```
1. 获取浏览器标签页
   ↓
2. 连接 WebSocket (CDP)
   ↓
3. 导航到发布页面
   ↓
4. 填充标题（input 元素）
   ↓
5. 填充正文（contenteditable 编辑器）
   ↓
6. 上传配图（Base64 转换）
   ↓
7. 输出确认信息
   ↓
8. 等待用户手动点击发布
```

### DOM 选择器

```javascript
// 标题输入框
input[placeholder*="标题"]
input[placeholder*="请填写"]
.byte-input__inner

// 正文编辑器
.ql-editor
[contenteditable="true"]
.public-DraftEditor-content

// 上传按钮
[class*="upload"]
input[type="file"]
```

## 示例

### 发布 Deep Post

```bash
# 准备内容
TITLE="别把存档当成学会"
CONTENT="你的收藏夹里躺着几十篇"干货"，除了点击"收藏"的那一秒，你再也没打开过它们。..."
IMAGE="output/deep-post-cards/01_别把存档当成学会.png"

# 发布
python3 scripts/publish-to-toutiao.py "$TITLE" "$CONTENT" "$IMAGE"
```

### 批量发布 35 篇

```bash
# 从文件读取内容
python3 scripts/batch-publish-toutiao.py \
  --posts /tmp/deep-posts-batch-35.txt \
  --images output/deep-post-cards/ \
  --count 35
```

## 输出示例

```
连接到今日头条...
打开发布页面...
填写标题: 别把存档当成学会
填写正文...
上传配图: output/deep-post-cards/01_别把存档当成学会.png
✓ 内容已填充
  标题: 别把存档当成学会
  正文长度: 159 字
  配图: output/deep-post-cards/01_别把存档当成学会.png

⚠️  测试模式：内容已填充，请手动检查并点击发布
```

## 注意事项

### 浏览器要求

- ✅ node PC 上的 Chrome 必须开启 remote debugging（端口 19226）
- ✅ 今日头条小号必须已登录
- ✅ Tailscale 网络必须连通

### 安全性

- **测试模式**: 默认只填充内容，不实际点击发布按钮
- **手动确认**: 用户需要在浏览器中检查内容后手动发布
- **防误发**: 避免自动化错误导致内容发布失败

### 限流

- 建议每篇间隔 5-10 秒
- 避免短时间内大量发布触发平台限制

## 故障排查

### 连接失败

```bash
# 检查 Tailscale 连接
tailscale status

# 测试端口
curl -s http://100.97.242.124:19226/json | head -5

# 检查今日头条是否登录
curl -s http://100.97.242.124:19226/json | grep "mp.toutiao.com"
```

### 内容填充失败

- **标题未填充**: 检查 DOM 选择器是否匹配
- **正文未填充**: 今日头条可能更新了编辑器结构
- **图片未上传**: Base64 转换或文件上传 API 可能变化

### 解决方案

1. **更新选择器**: 在浏览器 DevTools 中查找最新的 DOM 结构
2. **手动填充**: 如果自动化失败，先手动打开发布页面
3. **联系维护**: 如果平台升级，需要更新脚本

## 完整流程示例

### 场景：发布 35 篇 Deep Post 到今日头条

假设你已经有：
- 35 篇文案存储在 `/tmp/deep-posts-batch-35.txt`
- 35 张配图在 `output/deep-post-cards/`

**步骤 1：准备发布脚本**

创建 `batch-publish.sh`：
```bash
#!/bin/bash
# 批量发布脚本

# 读取文案（假设格式：Deep Post N: 标题\n正文\n）
# 匹配配图（output/deep-post-cards/0N_*.png）

for i in {1..35}; do
  echo "发布第 $i 篇..."

  # 从文件提取标题和正文（需要自己实现解析逻辑）
  TITLE=$(grep -A 1 "^Deep Post $i:" /tmp/deep-posts-batch-35.txt | tail -1)
  CONTENT=$(grep -A 10 "^Deep Post $i:" /tmp/deep-posts-batch-35.txt | tail -8)
  IMAGE=$(ls output/deep-post-cards/$(printf "%02d" $i)_*.png | head -1)

  # 发布
  python3 scripts/publish-to-toutiao.py "$TITLE" "$CONTENT" "$IMAGE"

  # 间隔 5 秒避免频繁操作
  sleep 5
done

echo "全部发布完成！"
```

**步骤 2：运行**
```bash
chmod +x batch-publish.sh
./batch-publish.sh
```

**预计时间**：35 篇 × (5秒发布 + 5秒间隔) = 约 6 分钟

## 已实现功能

- [x] 自动填充标题
- [x] 自动填充正文
- [x] 自动上传配图（Base64）
- [x] 自动点击发布按钮 ✨
- [x] 连接 node PC (Tailscale)
- [x] 错误提示

## 扩展功能（待实现）

- [ ] 支持定时发布
- [ ] 支持多图发布
- [ ] 支持话题标签
- [ ] 自动重试机制
- [ ] 发布状态监控（已发布/失败统计）
- [ ] 从 Notion 数据库读取内容自动发布

### 批量发布脚本

创建 `scripts/batch-publish-toutiao.py` 用于批量处理：

```python
# 读取 Deep Posts 列表
# 逐个发布到今日头条
# 记录发布状态
# 错误重试
```

## 性能指标

| 指标 | 数值 |
|------|------|
| 单篇发布时间 | ~5 秒 |
| 连接建立时间 | ~1 秒 |
| 页面加载时间 | ~3 秒 |
| 内容填充时间 | ~1 秒 |

## 相关 Skills

- **deep-post-generator**: 生成 Deep Post 内容和配图
- **platform-scraper**: 平台数据采集（包含今日头条）
- **image-gen-workflow**: 生成高质量配图

## 更新日志

### v2.0.0 - 2026-02-01

**✅ 全自动发布功能上线**
- 成功测试 3 篇内容自动发布到今日头条小号
- 自动点击发布按钮（不再需要手动确认）
- 发布成功率：100% (3/3)

**技术细节**：
- 找到正确的发布按钮选择器：`.menu-tab-stick-header-button`
- 解决返回值解析问题
- 添加发布间隔（避免频繁操作）

**已发布内容**：
1. "别把存档当成学会" - 159 字 + 配图 ✅
2. "礼貌的暴政" - 140 字 + 配图 ✅
3. "穷忙的快感" - 156 字 + 配图 ✅

### v1.0.0 - 2026-02-01 (已废弃)

- 初始版本：只填充内容，不点击发布
- 需要用户手动检查并点击发布按钮
