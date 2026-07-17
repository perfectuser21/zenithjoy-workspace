# 小改动 PrepPRD：国内厂商组合语音管线（阿里ASR + LLM + MiniMax TTS）

## 改什么
在已有的 `apps/realtime-voice-mvp/` 里新增一套国内厂商组合的语音对话管线，作为 OpenAI 版本的并行实现（不覆盖，路径区分）：
- 新增 `apps/realtime-voice-mvp/public/domestic.html`：国内版页面，浏览器通过 WebSocket 连自己服务器（不直连三方厂商）
- `server.js` 新增 WebSocket 服务端逻辑：浏览器 WS ⇄ 服务器，服务器内部转发到阿里云 ASR WebSocket（识别）→ LLM（阿里 Qwen 或 MiniMax-M2，生成回复文本）→ MiniMax TTS WebSocket（合成语音）→ 把音频块传回浏览器

## 为什么改
今天的 OpenAI Realtime 版本发现两个硬伤：①国内网络直连不了 api.openai.com（GFW，xian-m4 实测确认）②不支持声音克隆（用户需要）。国内三家（阿里ASR/LLM + MiniMax TTS）都已实测连通且用现有凭据可用，换成服务端中继架构规避网络问题，同时为后续声音克隆铺路。

## 关联上下文
- 直接延续本次会话内的 OpenAI 版本工作（PR #1361 已合并），无独立 Journey/Issue
- 无历史决策匹配（全新验证性 spike，非正式 Journey）

## 影响范围
新增文件为主（domestic.html + server.js 扩展 WebSocket 路由），不改动、不影响已上线的 OpenAI WebRTC 版本（两条路径独立，通过不同页面区分）。

## 验收标准
- [ ] 服务器 WebSocket 能正确转发音频到阿里云 ASR 并拿到识别文本
- [ ] 识别文本能正确送入 LLM 拿到回复文本
- [ ] 回复文本能正确送入 MiniMax TTS 拿到合成音频，并通过 WebSocket 传回浏览器播放
- [ ] 本地/部署环境实测能完整走通一轮"说话→识别→生成回复→合成语音→播放"闭环
- [ ] CI 全绿（含新增 smoke 脚本）
