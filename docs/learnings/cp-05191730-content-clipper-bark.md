# content-clipper Bark 推送 + expandUrl 修复

## 根本原因

1. **expandUrl ECONNRESET**：Douyin 短链接服务拒绝 HEAD 请求，返回 ECONNRESET，导致整条处理链崩溃。改用 GET + drain body 即可正常获取 Location header。
2. **无反馈**：服务运行结果无任何用户通知，用户无法知道剪藏是否成功。

## 下次预防

- [ ] 调用第三方平台时优先测试 GET；HEAD 不是所有平台都支持
- [ ] 新增后台服务时同步加 Bark/push 通知，避免黑盒运行
- [ ] error handler 中的 reject() 改为 resolve(原始URL) 可做 graceful fallback
