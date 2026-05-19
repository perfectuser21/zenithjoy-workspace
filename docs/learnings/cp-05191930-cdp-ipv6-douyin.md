# Douyin CDP 连接必须用 IPv6 [::1]

## 根本原因

Windows 上 `0.0.0.0:19222` 被 svchost.exe 占用，Chrome 的 CDP 实际监听在 `[::1]:19222`（IPv6 loopback）。  
content-service 用 `127.0.0.1:19222` 打到 svchost，立即收到 ECONNRESET，整条 Douyin 处理链崩溃。  
XHS 已正确用 `::1:19223`，Douyin 漏了。

## 下次预防

- [ ] 新增 CDP 连接时先用 `netstat -ano | findstr <port>` 确认是 Chrome 进程（不是 svchost）
- [ ] Windows CDP 统一用 `::1`（IPv6 loopback），不用 `127.0.0.1`
- [ ] 同端口多进程监听时，IPv4 的 0.0.0.0 不代表是目标进程
