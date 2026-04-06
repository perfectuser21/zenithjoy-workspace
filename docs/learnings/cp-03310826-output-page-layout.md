# Learning: PipelineOutputPage 全宽双栏布局

**分支**: cp-03310826-output-page-layout
**PR**: #102
**日期**: 2026-03-31

## 做了什么

将 PipelineOutputPage 的 GenerationTab 从上下堆叠布局重构为杂志式左右双栏，并移除全页 maxWidth 约束。

## 关键改动

1. **移除 maxWidth: 1100**：Hero 区和 Tab 容器统一改为全宽 + `padding: '0 60px'`
2. **GenerationTab flex 双栏**：
   - 外层 `display: flex, gap: 40, alignItems: flex-start`
   - 左栏 `flex: 3`：文章/卡片文案，`position: sticky, top: 70px`，独立 `overflowY: auto`
   - 右栏 `flex: 2`：封面图（`width: 100%`，不限高）+ 卡片图网格 + 生成阶段

## 经验

- **full-bleed 页面的宽屏布局**：去掉 maxWidth 后，用 flex ratio（3:2）而不是 `%` 宽度更灵活，能适应任意屏宽
- **sticky 左栏**：文章内容长时需要 `position: sticky` + `maxHeight: calc(100vh - 140px)` + `overflowY: auto`，否则左栏会跟随页面滚动消失
- **封面图不限高**：右栏封面图用 `width: 100%` 不设 height，让图片保持原比例，避免裁切
