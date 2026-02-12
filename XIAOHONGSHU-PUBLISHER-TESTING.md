# 小红书发布器测试说明

## 测试方法

小红书发布器是 Playwright 自动化工具，测试方式不同于传统的单元测试。

### 测试类型

| 类型 | 方法 | 说明 |
|------|------|------|
| 手动验证测试 | 人工执行发布流程 | Phase 1 必需 |
| 脚本测试 | 调用脚本发布测试内容 | Phase 2-3 |
| 端到端测试 | NAS → Mac mini → Windows → 小红书 | Phase 4 |

## Phase 1: 手动验证测试（当前阶段）

### 测试步骤

1. 打开小红书创作平台
2. 手动发布图文笔记
3. 手动发布视频笔记
4. 填写 `~/.claude/skills/xiaohongshu-publisher/VERIFICATION-CHECKLIST.md`

### 验收标准

- [ ] 图文笔记发布成功
- [ ] 视频笔记发布成功
- [ ] 所有选择器已记录
- [ ] 所有 API 端点已确认

## Phase 2-3: 脚本测试

### 测试数据准备

在 NAS 上创建测试目录：

```bash
/Users/jinnuoshengyuan/nas-publish/徐啸/creator/output/test-xhs/
├── xhs-post-1/
│   ├── type.txt         # "image"
│   ├── title.txt        # "测试图文笔记"
│   ├── content.txt      # "这是一条测试笔记"
│   └── image-1.jpg      # 测试图片
└── xhs-post-2/
    ├── type.txt         # "video"
    ├── title.txt        # "测试视频笔记"
    ├── content.txt      # "这是一条测试视频"
    ├── video.mp4        # 测试视频
    └── cover.jpg        # 测试封面
```

### 测试执行

```bash
# 在 Mac mini 上执行
ssh mac-mini 'bash ~/scheduler-xhs.sh test-xhs'
```

### 验收标准

- [ ] 图文笔记脚本执行成功
- [ ] 视频笔记脚本执行成功
- [ ] API 监听到成功响应
- [ ] 返回 note_id
- [ ] 小红书平台可见发布的内容

## Phase 4: 端到端测试

### 测试场景

| 场景 | 说明 | 预期结果 |
|------|------|----------|
| 单图发布 | 1 张图片 | ✅ 成功 |
| 多图发布 | 3 张图片 | ✅ 成功 |
| 最大图片数 | 9 张图片 | ✅ 成功 |
| 视频发布（有封面） | 视频 + 封面 | ✅ 成功 |
| 视频发布（无封面） | 只有视频 | ✅ 成功或使用自动封面 |
| 话题标签 | 内容包含 #话题# | ✅ 成功 |

### 测试数据

准备 5 组测试数据，覆盖上述场景。

### 测试执行

```bash
# 在 Mac mini 上执行
ssh mac-mini 'bash ~/scheduler-xhs.sh 2026-02-15'
```

### 验收标准

- [ ] 所有测试场景通过
- [ ] 成功率 100%
- [ ] 无错误日志
- [ ] 发布内容在小红书平台可见

## 测试记录

### 测试日志位置

- Mac mini: `/tmp/scheduler-xhs-YYYYMMDD.log`
- Windows PC: `C:\Users\xuxia\playwright-recorder\*.log`

### 成功标准

| 指标 | 目标 |
|------|------|
| 图文笔记成功率 | 100% |
| 视频笔记成功率 | 100% |
| 平均发布时间（图文） | < 60s |
| 平均发布时间（视频） | < 120s |

## 回归测试

### 何时需要回归测试

- 选择器变化（小红书平台更新）
- API 端点变化
- 脚本逻辑修改

### 回归测试步骤

1. 执行 Phase 1 手动验证（确认选择器）
2. 执行 Phase 2-3 脚本测试
3. 执行 Phase 4 端到端测试
4. 确认所有场景通过

## 对比：今日头条和抖音

| 平台 | 测试方法 | 成功率 | 说明 |
|------|----------|--------|------|
| 今日头条 | 端到端测试 | 100% | 3 种内容类型 |
| 抖音 | 端到端测试 | 100% | 3 种内容类型 |
| 小红书 | 端到端测试 | 预期 100% | 2 种内容类型 |

## 参考

- 今日头条发布器测试：`~/.claude/skills/toutiao-publisher/tests/`
- 抖音发布器测试：`~/.claude/skills/douyin-publisher/tests/`
