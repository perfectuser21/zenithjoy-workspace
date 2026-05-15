## AI 视频 upload INTERNAL_ERROR — pg-pool 被 execSync 饿死（2026-05-15）

### 根本原因

`AiVideoUploadService.dispatch()` 用 `execSync(ssh/scp)` 做远程操作，`execSync`
会阻塞整个 Node.js 事件循环（最长 120s）。

原始 controller 在 fire-and-forget dispatch 之后还 `await getGenerationById(jobId)`：

```
dispatch({...}).catch(...)  // NOT awaited — 但 dispatch 内 execSync 仍阻塞事件循环
const row = await aiVideoService.getGenerationById(jobId);  // ← 在此超时
```

当 pg-pool 的 `connectionTimeoutMillis: 2000` 定时器在事件循环被 execSync 冻住期间到期，
定时器回调被推迟到 execSync 结束后才触发，报 "timeout exceeded when trying to connect"，
导致第一次上传必然返回 500 INTERNAL_ERROR。

### 下次预防

- [ ] 凡用 `execSync` 做 I/O（SSH/SCP/文件）的函数，**不能**与任何 `connectionTimeoutMillis` 短的 DB 查询同帧运行 —— 要么用 async child_process，要么事先完成所有 DB 操作再 execSync
- [ ] fire-and-forget 后禁止继续做 `await pool.query()`；如需返回创建结果，直接用已知参数构造响应
- [ ] smoke 测试中 curl 超时必须 > execSync 最大耗时（dispatch SCP 最长 120s，curl 至少 60s）
- [ ] 避免 `|| echo "000"` 拼接到 curl 的 `-w "%{http_code}"` 输出，改用分离 exit code
