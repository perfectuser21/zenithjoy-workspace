# Product Map

<!-- digest: 0c3556c1bd2c0d6cc7e722ec4f0d6d047d90e4146a71c765eafaf2e426da2f08 -->

> 此文件由 `npm run product-map:generate` 自动生成，请勿手工编辑。
> 唯一手写源：`product-map/product-map.yaml`

## Apps & Lines

### customer_app — 客户端（Customer App）

| Line ID | Name |
|---------|------|
| line01 | Line 01 客户首次成功 |
| line02 | Line 02 客户智能获客 |
| line04 | Line 04 客户私域 AI 接管 |

### staff_app — 员工后台（Staff App）

| Line ID | Name |
|---------|------|
| line00 | Line 00 运营与系统 |

## Golden Paths

| ID | App | Line | Status | Steps | Smoke Files |
|----|-----|------|--------|-------|-------------|
| customer_first_success | customer_app | line01 | active | step1:注册自动登录（含 free license）<br>step2:装客户端 + Agent 自动连中台<br>step3:画像诊断（行业/受众/风格 3 字段）<br>step4:扫码绑定抖音主号（Agent 弹登录窗，session 存本地）<br>step5:AI 生成 1 条内容（接 Claude API）<br>step6:中台派任务 + dryrun 发布 + 回执 | .github/workflows/scripts/smoke/golden-path-1-smoke.sh |
| benchmark_link_acquisition | customer_app | line02 | proposed | step1:客户手填对标账号链接<br>step2:读对标账号视频→抓评论区<br>step3:触达带企微号→收好友→AI首答→写Lead表 | — |
| customer_smart_acquisition | customer_app | line02 | deprecated | — | — |
| keyword_acquisition | customer_app | line02 | active | step1:注册客户端自动登录<br>step2:装客户端 + Android 端 Agent 连中台<br>step3:系统自动建 3 张本地表（获客画像 / 对标视频 / Lead）落本地中台 DB<br>step4:客户在本地界面填获客画像 + 关键词<br>step5:手机端登录 2-3 个抖音小号 + 中台检测登录态<br>step6:按关键词搜索目标视频（替代手填对标 URL）<br>step7:评论区挖客闭环——抓评论→触达带企微号→企微webhook收好友→AI首答→写本地Lead表 | .github/workflows/scripts/smoke/golden-path-2-smoke.sh |
| live_acquisition | customer_app | line02 | proposed | step1:客户指定目标直播间/主播<br>step2:抓直播间互动观众<br>step3:触达带企微号→收好友→AI首答→写Lead表 | — |
| video_link_acquisition | customer_app | line02 | proposed | step1:客户手填目标视频链接<br>step2:抓该视频评论区<br>step3:触达带企微号→收好友→AI首答→写Lead表 | — |
| active_voice_outreach | customer_app | line04 | active | step1:拨号触发<br>step2:接通判定<br>step3:AI实时对话<br>step4:通话记录回写 | .github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh |
| business_report | customer_app | line04 | active | step1:数据齐备<br>step2:报告生成<br>step3:送达老板 | .github/workflows/scripts/smoke/cs-daily-report-smoke.sh |
| cs_shared_binding | customer_app | line04 | active | step1:注册自动登录<br>step2:装客户端 + Agent 连中台<br>step3:扫码绑定微信号 | .github/workflows/scripts/smoke/golden-path-4-smoke.sh |
| customer_private_ai | customer_app | line04 | deprecated | step1:中台扫码绑个微干净测试号<br>step2:飞书 Bitable 自动建 3 张表（客户档案 / 营销画像 / 内容排期）<br>step3:名单内客户私聊进来 → DeepSeek拼对话历史写回复草稿 → 写飞书互动记录表（待审）<br>step4:中台定时触发"今日朋友圈" → DeepSeek拼营销画像写文案草稿 → 写飞书内容排期表（待审）<br>step5:用户在飞书审批 → 批准后系统spawn wechat_rpa.py真发（强制频控）<br>step6:发布回执（成功/失败+原因）回写飞书内容排期+互动记录表 | .github/workflows/scripts/smoke/golden-path-4-smoke.sh |
| group_operation | customer_app | line04 | active | step1:群动静被感知<br>step2:响应与治理<br>step3:留痕 | — |
| moments_interaction | customer_app | line04 | active | step1:客户动态被感知<br>step2:互动决策<br>step3:互动执行与留痕 | — |
| moments_publish | customer_app | line04 | active | step1:内容成稿<br>step2:发布上圈<br>step3:发布确认与留痕 | .github/workflows/scripts/smoke/path4-sprint-1-ws4-smoke.sh |
| passive_reception | customer_app | line04 | active | step1:消息被感知<br>step2:决定谁来答<br>step3:回复送达<br>step4:留痕与善后 | .github/workflows/scripts/smoke/golden-path-4-smoke.sh<br>.github/workflows/scripts/smoke/line04-wxid-whitelist-smoke.sh<br>.github/workflows/scripts/smoke/line04-cs-memory-smoke.sh<br>.github/workflows/scripts/smoke/line04-cs-tenant-isolation-smoke.sh |
| ability_acceptance | staff_app | line00 | active | — | — |
| gp_anchor_enforcement | staff_app | line00 | active | — | .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh |
| line_health | staff_app | line00 | active | — | — |
| skill_acceptance | staff_app | line00 | active | — | — |

## Surfaces

- android
- api
- web
- windows

## Editions

- personal_wechat
- wecom
