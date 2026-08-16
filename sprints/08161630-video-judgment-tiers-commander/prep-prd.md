# 小改动 PrepPRD：视频判定三档 + DeepSeek commander 复核（step2 判定闸加固）

## 改什么
`apps/api/src/services/content-judgment.ts` 的视频判定闸，从"二值 matched/rejected（无法判断→保守 matched）"加固成**三档 + commander 二次判**：

- **主判**（Gemini `gemini-2.5-flash-official` via ToAPIs，不变）：读【前15秒转写文案 transcript + title + 画像】→ 输出 `MATCHED / REJECTED / UNCERTAIN`（新增第三档 UNCERTAIN=存疑）+ 理由
- **MATCHED** → matched（agent 抓评论往下）
- **REJECTED** → rejected（丢，不抓评论）
- **UNCERTAIN（存疑）** → **commander（DeepSeek via ToAPIs，同 TOAPIS_API_KEY，换 model 字段）**：拿【transcript + title + 画像 + **主判为什么判存疑的理由**】整体再看 → 只输出 **准 / 不准**（二值）→ 准=matched / 不准=rejected
- commander 解析失败/判不准 → **默认 rejected（丢，保守）**
- 对外 API 契约不变（仍 matched/rejected/pending）；三档是服务端内部消化
- DB `judgment_reason` 记判定轨迹（是否经 commander + 主判理由 + commander 理由）

## 为什么改
红线上移到视频层（决策：严在视频，松在私信）。原 rule#3"无法判断→matched"会把存疑视频直接放行、绕过意向；改成存疑交 commander（第二个 AI，无人工）复核，判"拒"错=丢整群客户（严重），判"通过"错=多抓无关评论（可接受），commander 是存疑的安全网。**红线不再靠人**——存疑用 AI commander 判，零人工。

## 关联上下文
- 推进 line02/keyword_acquisition **step2 内部判定闸**（steps 结构决策 60da58cf；不新增 step，是 step2"找符合画像视频"的实现手段）
- 判定点 1d078987 / decision f3dbc2ce / 4e421ae8：video 走音频转写、Gemini 明确输出转写文案落库
- 两个模型都走 ToAPIs（用户拍板：不走 openrouter）

## 影响范围
- 只动 content-judgment.ts + 测试 + smoke。**私信硬闸 outreach_eligible 不碰**（第二刀）。
- 对外 /judge-video 契约不变，agent 端零改动（存疑在服务端 commander 内部消化成 matched/rejected）。

## 判定点登记
| 判定点 | 所选方法 | 候选 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 主判视频三档 | Gemini 读文案+title+画像→MATCHED/REJECTED/UNCERTAIN | 二值/带阈值分数 | 复用现有 Gemini 链，最省改动 | 判"拒"错=丢整群客户(严重)；判"通过"错=多抓无关评论(可接受) |
| ⚠️ commander 复核 | DeepSeek(ToAPIs)拿主判理由整体判准/不准，默认不准=丢 | 同 Gemini 换严格 prompt / 换模型交叉验证 | 跨模型交叉验证比单模型自证更有意义；DeepSeek 已在评论分级用 | 存疑最后一道网；判"不准"错=漏客户，判"准"错=放无关的进 |

## 前置工作（全 ✅）
- [x] 前15秒转写文案 transcript — 已在 zenithjoy.acquisition_collect_videos（判定点 1d078987）
- [x] 主判模型 — Gemini via ToAPIs（TOAPIS_API_KEY，content-judgment.ts 已用）
- [x] commander 模型 — DeepSeek via ToAPIs（同 TOAPIS_API_KEY，OpenAI 兼容换 model 即可；ToAPI 有 deepseek-v4-flash）
- 无需新 key / 新 fixture

## 验收标准
- [ ] 红测试先 commit：主判 UNCERTAIN → 触发 commander；commander 准→matched、不准→rejected、解析失败→rejected（默认拒）；主判 MATCHED/REJECTED 不调 commander
- [ ] 实现让红测试转绿
- [ ] proven-to-fire：真调一次 ToAPIs DeepSeek 确认 commander 模型可用、能返回准/不准
- [ ] CI 全绿
