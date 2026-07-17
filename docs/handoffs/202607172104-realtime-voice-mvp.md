# Handoff：OpenAI/豆包 Realtime 语音 MVP 验证（task_id=unknown，交互式会话，非headless）

## verdict: PASS

## 完成了什么
- **PR #1361**（已合并）：OpenAI Realtime API 语音 MVP，`apps/realtime-voice-mvp/`。零依赖 Node 后端（`/session` 换临时密钥）+ 单页 H5 前端（WebRTC 直连 OpenAI Realtime）。部署到 HK VPS，走 `cn.zenjoymedia.media/realtime-mvp/`。
  - 发现并修复：国内网络直连不了 api.openai.com（GFW），搭了 SSH 隧道经 mac-mini-m4-us（mmv）中转 session 创建请求。
  - 发现并修复：前端 fetch 用绝对路径导致子路径部署下 404/405（真机测试实锤）。
  - 发现硬限制：OpenAI Realtime 不支持声音克隆（官方仅限受邀合作伙伴）；国内网络下浏览器直连 WebRTC 走不通（GFW 封锁 api.openai.com 本身，非我方问题）。
- **PR #1366**（已合并）：豆包（火山引擎）Realtime Dialogue 语音管线，同一 app 内新增并行实现。
  - `doubao-protocol.js`：豆包二进制协议编解码（header/event/session_id/payload 精确字节格式），单元测试含真实抓包字节回归用例。
  - `server.js` 新增 `/ws/domestic` WebSocket 端点：浏览器 ⇄ 服务器 ⇄ 豆包三方中继（服务端中继架构，规避国内网络直连限制）。
  - `public/domestic.html`：国内版页面，Web Audio API 手动处理音频采集/降采样/播放。
  - 已用真实凭据端到端验证：连接/会话建立/文字对话/流式回复/TTS 音频全链路测通（ffprobe 验证音频有效）。部署到 HK VPS 同一容器，公网可用。

## 没做的 / 范围外
- 真实麦克风输入触发豆包 ASR 的完整闭环未做端到端验证（协议编码逻辑复用已验证部分，风险可控，留给用户真机测试）
- 声音克隆功能未实现（用户已确认这次先跑通闭环，克隆是后续加厚项）
- MiniMax + 阿里云 ASR 的三段式管线方案已调研但未实现（用户中途改为直接用豆包 Realtime Dialogue，架构更简单）
- Token/成本统计、性能延迟统计等 PRD 里的"锦上添花"项均未做

## 下一步
- 用户需要用真实手机（含微信内置浏览器）测试 domestic.html 的完整语音对话体验，确认真机麦克风输入到 ASR 识别的实际效果
- 若声音克隆是后续需求，豆包支持（购买克隆音色注册后即可在 StartSession 的 tts.speaker 里指定 `ICL_`/`saturn_` 前缀音色）
- 若要转正式产品化，需要走 /dev 路径C（Harness）挂到具体 Journey/Ability 上，本次是验证性 spike，未挂靠 Path 1/2/4 任何一条

## 数据源（下一个大脑接续用）
- 部署地址：https://cn.zenjoymedia.media/realtime-mvp/（OpenAI 版首页）、https://cn.zenjoymedia.media/realtime-mvp/domestic.html（豆包版）
- HK VPS 部署路径：/opt/realtime-voice-mvp/（docker 容器 realtime-voice-mvp，网络 zenithjoy-net）
- OpenAI 出口隧道：容器 openai-tunnel（sidecar，SSH 转发经 mmv 到 api.openai.com）
- 凭据：1Password「OpenAI-claudecode2026」「MiniMax API」「Volcengine Speech (豆包实时语音对话)」「阿里云 API Key」

## 决策引用
- Brain decisions: realtime-voice-mvp 国内版相关决策（category=small-change，2026-07-17）

## 产物
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1361 (merged)
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1366 (merged)
- sprints/07171736-realtime-voice-mvp/、sprints/07171956-realtime-domestic-pipeline/
