## AI 视频流水线：废话分析 + FFmpeg 粗剪（2026-05-21）

### 根本原因

原始流水线（v1.1.13 及之前）只将原始视频当作 HyperFrames 的背景小窗口，叠加 AI 生成的文字动效，没有做任何视频剪辑。用户录制时产生的废话、气口、跑题内容全部原封不动保留在输出视频里。

### 下次预防

- [ ] 每个新流水线步骤必须在 PR 描述中说明"输入是什么、输出是什么、失败降级策略是什么"
- [ ] FFmpeg filter_complex 传参必须用 `quoteArg` 包裹（已有先例：`buildOverlayFilters`），注意分号在 Windows 引号内不需要额外转义
- [ ] analyze-transcript 返回数组长度必须等于输入 segments 数量，才认为有效；否则全部保留（fail-safe）
- [ ] rough cut 失败时记录警告但不抛出（降级到原视频），保证流水线不中断
- [ ] 时间戳重算逻辑：精细化 segments 的 start = 累计前序片段时长，不是原始 start
- [ ] 所有 HyperFrames copyFile 和音频 merge 步骤都要从 roughCutPath 拿，不要从 videoPath 拿
