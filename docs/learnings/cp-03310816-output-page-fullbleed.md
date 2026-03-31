# Learning: PipelineOutputPage 全宽独立页面

**分支**: cp-03310816-output-page-fullbleed
**日期**: 2026-03-31
**类型**: feat

---

## 问题根因

Dashboard 所有页面共用一套 layout（sidebar + header + p-8），导致 PipelineOutputPage 这种"作品展示页"没有独立网页的沉浸感。用户觉得"不像一个单独的网页"。

## 解决方案

### isFullBleed 路由检测（App.tsx）

```js
const isFullBleed = /^\/content-factory\/[^/]+\/output\/?$/.test(location.pathname)
```

三处条件判断：
1. `isAuthenticated && !isFullBleed` → 不渲染 sidebar
2. `isAuthenticated && !isFullBleed ? 'ml-*/pt-16...' : 'flex-1 overflow-auto'` → main 不加 margin
3. `isAuthenticated && !isFullBleed ? 'p-8 page-fade-in' : ''` → 内层 div 不加 padding

**关键设计**：用正则而非字符串匹配，避免 `/content-factory/` 列表页也被误判。

### 页面级全屏（PipelineOutputPage.tsx）

- `document.documentElement.requestFullscreen()` — 全屏整个浏览器窗口（区别于灯箱图片全屏）
- `fullscreenchange` 事件同步状态 → Maximize2/Minimize2 图标切换
- 放在导航栏右侧，小按钮不干扰主内容

## 层级区别

| 全屏类型 | 触发方式 | 作用域 |
|---------|---------|--------|
| 页面全屏 | 导航栏右上角按钮 | 整个浏览器窗口 |
| 灯箱全屏 | 灯箱内 Maximize2 或 F 键 | 灯箱容器元素 |

两者独立，不冲突。

## 注意事项

- 只有 `/content-factory/:id/output` 这一个路由走 full-bleed，其他页面不受影响
- 未登录时本来就没有 sidebar（原有逻辑），full-bleed 逻辑只对已登录用户有意义
- `requestFullscreen()` 需要用户手势触发（按钮点击），不能自动触发
