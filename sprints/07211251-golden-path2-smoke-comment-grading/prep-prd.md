# Bug PrepPRD：PR #1444 的评论判定修复未回流 golden-path-2-smoke.sh

## 症状
PR #1444（评论判定 grade 全空修复 + 判定引擎换 DeepSeek）只补了 vitest 单测 + 一个集成测试，没有把复现判据回流进 `golden-path-2-smoke.sh`。违反 ZenithJoy 铁律 5："真机 bug 修复 PR 必须回流 smoke...只进 vitest 不进 smoke = 同一坑必然摔第二次"。

## 根因假设
现有 smoke 里跟"判定"沾边的步骤都没测到这次改的东西：
- Step 8 测的是**视频内容判定**（`judge-video` → `content-judgment.ts`，用 Gemini），跟这次改的**评论意向判定**（`comment-grading.ts`，换成 DeepSeek）是两个不同服务
- Step 9/15/22 调 `/collect/report` 时显式传 `"grade":"高意向"` 字段，故意绕开真实判定链路（注释写明"本身就不依赖评级真调链"），确保这几步的断言（douyin_id 落库、派单串联）不受 AI 判定不确定性影响——但代价是这次的核心 bug（画像为空静默失败无日志、DeepSeek 判定是否真的产出非 null 结果）完全没有机器判据守着

## 关联上下文
- PR #1444（已合并）
- Brain task db71a584-bf4a-4b3b-9e77-a76b328fd07c

## 修法
在 `golden-path-2-smoke.sh` 里新增 Step 23（Step 22 是当前最后一步），分两段：

**Step 23a（画像为空 → 有日志不再静默）**：全新 tenant（仿 Step 10a 的 sign-up 模式，从未 PATCH `acquisition_config`）→ `/collect/report` 上报一条评论、不传 `grade` 字段 → 断言：① `acquisition_lead_comments.grade` 落库为 NULL ② 服务端日志文件（`/tmp/apps-api.log`，CI workflow 里已有 `node dist/index.js > /tmp/apps-api.log 2>&1 &` 的先例，Step 728 已有 grep 该文件的先例）里出现 `[comment-grading] target_profile_desc 为空`。

**Step 23b（已配置画像 → 真实 DeepSeek 判定驱动 outreach_eligible）**：复用主 `TENANT_ID`（Step 5 已配置画像）+ `AGENT_PK` → `/collect/report` 上报一条明确高意向评论（如"求报价，多少钱一平，加个微信详细聊"）、不传 `grade` 字段（纯靠真实判定）→ 断言：① 该 lead `grade` 落在 `高意向`/`精准` ② `outreach_eligible=true`。跟 Step 8 一样接受"真调外部 API"的模型输出变动性风险，选足够无歧义的文案降低翻车概率。

同步更新：文件头 Step 清单加一行、末尾"22 步"改"23 步"、清理临时文件列表加新变量。

## Regression Test 计划
Step 23 本身就是 regression test（machine-checked，进 CI 每次跑）。**Proven-to-fire 验证**：本地起 API server + Postgres，先临时把 `comment-grading.ts` 的画像为空分支 warn 日志删掉（模拟修复前状态），跑 Step 23a 确认真报红（日志 grep 不到），再改回来确认转绿；Step 23b 不需要刻意破坏（真实调用 DeepSeek 本身就是判据）。

## 验收标准
- [ ] Step 23a/23b 加入 smoke 脚本，本地跑通
- [ ] Step 23a 亲眼验证过报红一次（proven-to-fire）
- [ ] CI 全绿
