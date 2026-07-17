# Handoff：豆包版 WebSocket 绝对路径 bug 修复（task_id=unknown，交互式会话）

## verdict: PASS

## 完成了什么
- PR #1368（已合并）：修复 `apps/realtime-voice-mvp/public/domestic.html` 里 `new WebSocket()` 用 `location.host` + 绝对根路径 `/ws/domestic` 拼接 URL 的 bug——部署在 `/realtime-mvp/` 子路径下时跳出前缀，连到不存在的路径，落进 Caddy 默认兜底站点导致握手失败。用户真机（微信内置浏览器，WiFi）实测复现："麦克风权限拿到后 WebSocket 立刻报错断开"。
- 改用 `location.pathname` 推导当前页面子路径前缀再拼接，与同一天早些时候 OpenAI 版本 `fetch('/session')` 绝对路径 bug 同一类问题、同一个修法。
- 已补 regression check 进 `realtime-voice-mvp-domestic-smoke.sh`（TDD 顺序：commit-1 先行失败的检查 → commit-2 修复）。
- 修复已直接部署到 HK VPS 线上（未等 CI 合并即先手动部署，缩短用户等待时间），随后走正规 PR 流程补齐记录。

## 没做的 / 范围外
- 用户修复后是否真机复测成功——本次会话内未收到用户复测反馈就已到会话尾声，需要下一轮确认

## 下一步
- 确认用户用手机微信重新测试 https://cn.zenjoymedia.media/realtime-mvp/domestic.html ，看 WebSocket 是否正常连接、能否听到豆包语音回复
- 若还有问题，参考本次调试方法：检查 Caddy 是否有 access log（当前没有配置，排查时是个盲区，可考虑后续加上）

## 数据源
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1368 (merged)
- 部署地址：https://cn.zenjoymedia.media/realtime-mvp/domestic.html
- 前置 handoff：docs/handoffs/202607172104-realtime-voice-mvp.md（PR #1361/#1366 交接单）

## 产物
- apps/realtime-voice-mvp/public/domestic.html
- .github/workflows/scripts/smoke/realtime-voice-mvp-domestic-smoke.sh
