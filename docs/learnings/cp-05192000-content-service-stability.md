# content-service 稳定性修复合集

## 根本原因

1. **play_addr 无音频**：`bit_rate[0]`（最低码率）在 Douyin 某些视频是纯视频流，需用 `v.play_addr`（始终含音轨的合并流）
2. **CDP ECONNRESET**：Windows 上 `0.0.0.0:19222` 被 svchost 占用，Chrome CDP 实际在 `[::1]:19222`（IPv6），连错进程即 ECONNRESET
3. **relay 无重试**：OpenRouter 偶发 502/timeout，整条链路失败无恢复
4. **callback 无重试**：N8N 重启窗口内回调失败，内容丢失

## 下次预防

- [ ] 新增 CDP 连接前用 `netstat -ano | findstr <port>` 确认监听进程是 chrome.exe
- [ ] Windows 上 CDP 统一用 `::1`（IPv6 loopback）
- [ ] 外部服务调用（relay/callback）必须有 2-3 次重试
- [ ] Douyin 视频流优先用 `play_addr`，不要 `bit_rate[0]`
