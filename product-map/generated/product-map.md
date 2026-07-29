# Product Map

<!-- digest: 81299f155a7a890161ef5bacc296794f7e94cf6f22f71a8470361be9e26922f9 -->

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
| customer_smart_acquisition | customer_app | line02 | active | step1:注册客户端自动<br>step2:装客户端<br>step3:Android 端 Agent 连中台<br>step4:绑客户飞书企业（已废弃）<br>step5:系统自动建 3 张本地表（获客画像 / 对标视频 / Lead）落本地中台 DB<br>step6:客户在本地界面/dashboard 填获客画像 + 手填对标视频 URL<br>step7:手机端登录 2-3 个抖音小号 + 中台检测登录态<br>step8:评论区挖客闭环——读对标视频→抓评论→触达带企微号→企微webhook收好友→AI首答→写本地Lead表 | .github/workflows/scripts/smoke/golden-path-2-smoke.sh |
| customer_private_ai | customer_app | line04 | active | step1:中台扫码绑个微干净测试号<br>step2:飞书 Bitable 自动建 3 张表（客户档案 / 营销画像 / 内容排期）<br>step3:名单内客户私聊进来 → DeepSeek拼对话历史写回复草稿 → 写飞书互动记录表（待审）<br>step4:中台定时触发"今日朋友圈" → DeepSeek拼营销画像写文案草稿 → 写飞书内容排期表（待审）<br>step5:用户在飞书审批 → 批准后系统spawn wechat_rpa.py真发（强制频控）<br>step6:发布回执（成功/失败+原因）回写飞书内容排期+互动记录表 | .github/workflows/scripts/smoke/golden-path-4-smoke.sh |
| ability_acceptance | staff_app | line00 | deprecated | — | — |
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
