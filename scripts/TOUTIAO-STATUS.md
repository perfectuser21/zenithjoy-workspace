# 今日头条自动发布 - 开发状态

## 重要说明（CRITICAL）

今日头条有 **三种** 内容类型：

| 类型 | 状态 | 优先级 | 说明 |
|------|------|--------|------|
| **文章** | ✅ 已完成 | P3 | 长图文内容，有标题 |
| **微头条** | ✅ 已完成 | **P1** | 短内容，纯文本发布，已测试成功 |
| **视频** | ⏳ 待完成 | **P1 重点** | 视频内容 |

**开发优先级**：微头条 > 视频 > 文章（已完成）

## 当前状态总览

### ✅ 已完成

#### 1. 文章发布（100%）
- **脚本**: `auto-publish-complete.cjs` ✅
- **功能**: 完整的图文发布流程
  - ✅ 导航到编辑页面
  - ✅ 填写标题（React受控输入）
  - ✅ 填写内容（ProseMirror编辑器）
  - ✅ 上传图片（drawer文件选择）
  - ✅ 选择封面类型（单图/三图）
  - ✅ 配置发布选项
  - ✅ 点击发布
  - ✅ 处理确认弹窗
  - ✅ 验证发布成功
- **测试**: 已成功发布测试文章 ✅
- **截图**: `/tmp/publish-screenshots/` ✅

#### 2. 文件组织系统（100%）
- **脚本**: `upload-to-desktop-organized.sh` ✅
- **功能**:
  - ✅ VPS → Windows 文件传输
  - ✅ 按北京时间创建日期文件夹
  - ✅ 按类型分类（images/videos）
  - ✅ 使用帖子标题命名文件
- **文件结构**:
  ```
  Desktop/
  └── 2026-02-09/
      ├── images/
      │   ├── 标题-1.jpg
      │   ├── 标题-2.jpg
      │   └── 标题-3.jpg
      └── videos/
          └── 标题-1.mp4
  ```

#### 3. 通用发布框架（80%）
- **脚本**: `toutiao-publish-universal.cjs` ✅
- **功能**:
  - ✅ 统一配置格式（JSON）
  - ✅ 图文发布完整实现
  - ⏳ 视频发布框架准备（等待UI调查）
  - ✅ 错误处理和截图
  - ✅ 状态验证

#### 4. 文档（100%）
- ✅ README-toutiao-publisher.md - 完整使用说明
- ✅ TOUTIAO-STATUS.md - 开发状态（本文档）
- ✅ /tmp/TOUTIAO-VIDEO-FINDINGS.md - 视频发布调查结果

### ⏳ 待完成

#### 1. 微头条图片上传（90%）
**状态**: 基础功能完成，图片上传待完善

**已实现**:
- ✅ 内容填写（ProseMirror编辑器）
- ✅ 纯文本发布
- ✅ hashtag话题标签
- ✅ 发布成功验证

**待完善**:
- ⏳ 图片上传功能（需要进一步UI分析）

**脚本**: `scripts/publish-weitoutiao.cjs`

**入口**: `https://mp.toutiao.com/profile_v4/weitoutiao/publish`

#### 2. 视频发布（0%）
**状态**: 重点待实现（用户要求 P1）

**已尝试的URL**:
- ❌ `https://mp.toutiao.com/profile_v4/xigua/publish` - 只显示侧边栏
- ❌ `https://mp.toutiao.com/profile_v4/video/publish` - 只显示侧边栏
- ❌ `https://studio.ixigua.com/upload` - 重定向到抖音

**下一步**:
1. 手动在浏览器中发布一个视频
2. 记录：
   - 完整URL路径
   - 上传按钮的位置
   - file input 的选择器
   - 视频 accept 属性
   - 封面上传流程
   - 发布选项
3. 实现自动化脚本（预计与图文类似）

**可能的原因**:
- 视频可能通过"西瓜视频"平台发布
- 可能需要特定权限或认证
- 可能需要移动端App

#### 2. 增强功能
- [ ] 状态追踪（发布历史记录）
- [ ] 队列管理（批量发布）
- [ ] 错误重试机制
- [ ] 定时发布功能

#### 3. Skill集成
- [ ] 创建 `~/.claude/skills/toutiao-publisher/`
- [ ] SKILL.md 定义
- [ ] 与 Cecelia 任务系统集成
- [ ] 从内容库自动读取

## 技术突破

### 关键发现1: Drawer中的文件上传
**问题**: 初始时找不到file input
**解决**:
- file input 在 `.byte-drawer` 组件内
- 需要先点击 `.article-cover-add` 打开drawer
- 然后才能找到并操作file input

### 关键发现2: React受控输入
**问题**: 直接设置value不触发React状态更新
**解决**:
```javascript
const setter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(textarea),
  'value'
).set;
setter.call(textarea, value);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
```

### 关键发现3: 确认弹窗处理
**问题**: 有时发布后出现确认弹窗
**解决**: 检测并自动点击"确认"按钮

## 文件清单

### 生产脚本
| 文件 | 状态 | 说明 |
|------|------|------|
| `auto-publish-complete.cjs` | ✅ 稳定 | 完整图文发布（已测试成功）|
| `toutiao-publish-universal.cjs` | ⏳ 开发中 | 通用发布（图文✅，视频⏳）|
| `upload-to-desktop-organized.sh` | ✅ 稳定 | 文件组织和传输 |

### 测试/调查脚本（在 /tmp/）
| 文件 | 说明 |
|------|------|
| `inspect-video-page.cjs` | 视频页面UI调查 |
| `navigate-to-video.cjs` | 导航到视频发布页 |
| `check-creation-options.cjs` | 检查创作选项 |
| `upload-drawer-input.cjs` | Drawer文件上传测试 |
| `click-zhilan.cjs` | DOM监听器测试 |

### 文档
| 文件 | 说明 |
|------|------|
| `README-toutiao-publisher.md` | 完整使用文档 |
| `TOUTIAO-STATUS.md` | 开发状态（本文档）|
| `/tmp/TOUTIAO-VIDEO-FINDINGS.md` | 视频发布调查结果 |

## 测试记录

### 图文发布测试 ✅
- **时间**: 2026-02-09
- **内容**:
  - 标题: "探索人工智能技术在现代社会的应用与发展趋势分析"
  - 图片: 3张
  - 封面: 三图
- **结果**: 成功发布
- **截图**: `/tmp/publish-screenshots/01-11.png`

## 性能数据

- CDP连接延迟: ~100ms
- 图文发布总时长: ~40秒
  - 页面加载: 5秒
  - 填写内容: 3秒
  - 上传图片: 10秒
  - 发布确认: 10秒
  - 验证: 5秒

## 依赖环境

### 系统
- VPS: Linux (146.190.52.84)
- Windows: 100.97.242.124
- 网络: Tailscale VPN

### 服务
- Chrome CDP: 100.97.242.124:19225
- File Receiver: 100.97.242.124:3001

### 软件
- Node.js (VPS)
- Chrome with remote debugging (Windows)
- SSH access (Windows)

## 下一步计划

### 短期（本周）
1. 手动探索视频发布UI ⏳
2. 实现视频上传自动化 ⏳
3. 测试完整视频发布流程 ⏳

### 中期（本月）
1. 创建toutiao-publisher Skill
2. 集成到Cecelia任务系统
3. 实现批量发布队列
4. 添加状态追踪

### 长期（季度）
1. 支持更多平台（抖音、快手、小红书）
2. 内容自动生成和优化
3. 数据分析和效果追踪
4. 智能发布时间优化

## 问题追踪

### 已解决
- ✅ File input 0KB问题 - 在drawer外查找导致
- ✅ React输入不更新 - 使用Object.getOwnPropertyDescriptor
- ✅ 文件命名混乱 - 实现日期/类型组织
- ✅ 时区错误 - 使用北京时间

### 待解决
- ⏳ 视频发布入口未找到
- ⏳ 西瓜视频平台集成

## 维护说明

### 更新脚本
1. 修改对应的 `.cjs` 或 `.sh` 文件
2. 在 `/tmp/` 测试新版本
3. 测试通过后覆盖 `scripts/` 中的文件
4. 更新文档

### 调试
1. 检查 `/tmp/publish-screenshots/` 截图
2. 查看 CDP 连接状态
3. 验证 Windows 文件接收器运行
4. 确认 Tailscale VPN 连接

---

**最后更新**: 2026-02-09 17:58 (北京时间)
**开发者**: Claude Code (Opus 4.6)
**状态**: 图文发布生产就绪 ✅ | 视频发布待UI调查 ⏳
