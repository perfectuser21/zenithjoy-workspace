---
branch: cp-04011430-fix-scraper-toutiao-port
date: 2026-04-01
type: fix
score: 18/25
---

# Learning: 修复头条爬虫 CDP 端口

## 问题
`scraper-toutiao-v3.js` 硬编码 `PORT = 19225`，但 Windows PC 的 19225（头条-主）端口不可达；19226（头条-副）为实际运行实例。

## 根因
发布脚本已于 2026-03-18 将头条端口从 19225 修正为 19226，但爬虫脚本未同步更新。

## 修复
单行修改：`const PORT = 19225` → `const PORT = 19226`

## 教训
发布脚本和爬虫脚本共用 CDP 端口映射，端口变更时需同时更新两处。
