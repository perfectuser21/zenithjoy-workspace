# Learning: 灯箱全屏+上下张切换+UI优化

**Branch**: cp-03302243-pipeline-fix
**PR**: #99
**Date**: 2026-03-30

## 做了什么

升级 PipelineOutputPage 的图片灯箱：
- 浏览器原生 `requestFullscreen` API，按 F 键快捷全屏
- 上下张切换：← → 方向键 + 屏幕按钮
- 图片计数 「3 / 8」+ 底部缩略图条
- 移除文章区 `maxHeight: 300` 截断
- 封面图 110px → 160px

## 关键设计

**LightboxState**: 把 `lightbox: string | null` 改为 `lightbox: { index: number; urls: string[] } | null`，在灯箱内部维护 `currentIndex`，可以本地切换而无需提升状态。

**Fullscreen API**: `containerRef.current?.requestFullscreen()` 作用于灯箱容器本身（不是 `document.documentElement`），让全屏内容居中更干净。监听 `fullscreenchange` 事件同步 `isFullscreen` 状态。

## 遗留问题（下一步）

**图片看不见的根本原因（Brain API，cecelia 仓库）**：
- Brain API 的 topic 把 "Dan Koe" → "dan-koe"，但图片文件名是 "dankoe-*.png"（无连字符）
- 修复方案：在 `content-pipeline.js` 中同时扫描 `topic` 和 `topic.replace(/-/g,'')` 两种形式
- 需要单独在 cecelia 仓库创建 PR
