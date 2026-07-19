# Bug PrepPRD：真机验证音频判定修复（PR #1404）时发现 /judge-video 对真实音频负载全部 500

## 症状

2026-07-19 用 PR #1404 合并后的新 APK 在真机（xian-rog HONOR 100，agent 841a6bec-baef-4f6a-83b3-30b3e38e832b）跑真实 Path2 采集任务：Stage1 采集真实成功（3 个视频，含真实 title，验证了 PR #1404 的 title 采集修复），但 Stage2 判定阶段 `/judge-video` 三次调用全部返回 HTTP 500。

## 根因

`docker logs zenithjoy-api-staging` 抓到真实错误：
```
Internal error: PayloadTooLargeError: request entity too large
  expected: 872435, length: 872435, limit: 102400, type: 'entity.too.large'
```

`apps/api/src/app.ts:89` 的 `app.use(express.json())` 没有传 `limit` 选项，body-parser 默认上限只有 100KB（102400 字节）。

PR #1404 修好 RECORD_AUDIO 权限后，`AudioRecordService` 第一次真正录到 20 秒 16kHz 单声道 16bit 音频：640,000 字节裸 PCM（+WAV header 44字节）→ base64 编码后膨胀到约 853KB，加上 JSON 其余字段，总请求体 ~870-880KB，远超 100KB 限制，全部被 Express 拒绝。

这是 PR #1404 之前从未被真机撞到的坑——RECORD_AUDIO 权限缺失时，录音必现 SecurityException，`captureAudioSnippet()` 返回 null，客户端改以 `capture_type=skipped_capture_failed` + 空 `data_b64` 回报，请求体极小，从未真正走过大音频负载这条路径。权限修好后，这条路径第一次被真实数据触达，body-parser 限制才第一次暴露。

## 关联上下文
- 相关 PR：#1404（音频转写判定三缺口修复，本 bug 是其验证过程中发现的新缺口）
- 相关历史决策：判定点 `1d078987`（固定录制开头20秒音频）——本 bug 的负载体积直接由这个时长决定
- Brain decisions/issues 查询：无匹配的既有记录（新发现）

## 修法

`apps/api/src/app.ts:89`：`app.use(express.json())` 改为 `app.use(express.json({ limit: '1mb' }))`。

1mb 留了约 18% 余量（受限于hk-vps nginx反代对/api/通用路径未覆盖client_max_body_size，默认1MB，staging+prod两套拓扑一致——Express设更大也会被nginx先截断，1mb是不碰生产nginx配置前提下的安全上限）（当前实测约 870-880KB），覆盖：
- WAV header 开销（44字节，可忽略）
- base64 膨胀比 4/3 的精确性误差
- 未来若 title/其他字段变长
- 不同录音时长下的采样率误差

不做成按路由差异化限制（更精细但增加维护面），也不去改 hk-vps 上的 nginx 配置（那是生产基础设施改动，风险等级不同、且本次不需要——1mb 已经在 nginx 现有 1MB 上限之内），因为：
1. 这是内部 agent-to-server API，不是公网任意用户上传，DoS 风险可控
2. 截图（JPEG）路径理论上也可能因为高分辨率/低压缩率遇到同样问题，全局提升同时修复潜在的姊妹坑
3. 1mb 对比 Node.js 进程内存和网络带宽都不是激进值，且与 nginx 侧默认值对齐，避免两层限制不一致的隐患

## Regression Test 计划

集成测试 `apps/api/tests/integration/p2-line02-content-judgment/judge-video-large-audio-payload.integration.test.ts`：构造与真机实测同量级（640,000 字节裸数据 base64 后约853KB）的 `data_b64`，POST `/judge-video`（`force_result=matched` 测试钩子跳过真调 Gemini），断言响应不是 413/500 而是 200 + `judgment_status=matched`。

commit-1 时 RED（真实复现 body-parser 拒绝）；commit-2 GREEN（改 limit）。

## proven-to-fire 守卫

这是纯逻辑接缝（body-parser 配置，不依赖真机/真实调用方）——集成测试本身即 proven-to-fire 守卫：commit-1 阶段已实测报 413/500（本机 `npm run test:integration` 跑过一次 RED），commit-2 后转绿，CI 每次跑都会验证这条边界。

## 验收标准
- [ ] failing test 先 commit（commit-1，本机已验证过 RED）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] apps/api 全量单测 + 集成测试无回归
- [ ] CI 全绿
- [ ] （已完成，不阻塞 CI）真机重新触发一次真实采集任务，确认 `/judge-video` 返回 200 且 DB `judgment_status` 不再是空/pending
