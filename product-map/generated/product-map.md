# Product Map

<!-- digest: 2fdb9e52b611d1d121a517570f030aca6e6761b70bb61dbb79deced4da00d397 -->

> 此文件由 `npm run product-map:generate` 自动生成，请勿手工编辑。
> 唯一手写源：`product-map/product-map.yaml`

## Apps & Lines

### customer_app — 客户端（Customer App）

| Line ID | Name |
|---------|------|
| line01 | Line 01 智能发布 |
| line02 | Line 02 智能获客 |
| line04 | Line 04 智能客服 |
| line05 | Line 05 视频剪辑 |
| line07 | Line 07 AI爆款视频翻拍 |

### staff_app — 员工后台（Staff App）

| Line ID | Name |
|---------|------|
| line00 | Line 00 运营中枢 |
| line10 | Line 10 客户管理 |
| line11 | Line 11 员工知识中枢 |

## Golden Paths

| ID | App | Line | Status | Steps | Smoke Files |
|----|-----|------|--------|-------|-------------|
| customer_first_success | customer_app | line01 | active | step1:注册自动登录（含 free license）<br>step2:装客户端 + Agent 自动连中台<br>step3:画像诊断（行业/受众/风格 3 字段）<br>step4:扫码绑定抖音主号（Agent 弹登录窗，session 存本地）<br>step5:AI 生成 1 条内容（接 Claude API）<br>step6:中台派任务 + dryrun 发布 + 回执 | .github/workflows/scripts/smoke/golden-path-1-smoke.sh |
| benchmark_link_acquisition | customer_app | line02 | proposed | step1:客户手填对标账号链接<br>step2:读对标账号视频→抓评论区<br>step3:触达带企微号→收好友→AI首答→写Lead表 | — |
| customer_smart_acquisition | customer_app | line02 | deprecated | — | — |
| keyword_acquisition | customer_app | line02 | active | step1:中台显示手机上有 N 个可用抖音小号<br>step2:系统按关键词替客户找到符合画像的目标视频，中台可见清单<br>step3:Lead 表出现带抖音号的潜在客户<br>step4:系统用小号给线索发出私信，客户看到每条已发出/被限流/失败/已送达 | .github/workflows/scripts/smoke/golden-path-2-smoke.sh |
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
| video_editing | customer_app | line05 | active | — | .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh |
| viral_video_remake | customer_app | line07 | active | — | .github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh |
| ability_acceptance | staff_app | line00 | active | — | — |
| f1_dev_loop | staff_app | line00 | active | step1:接单进车间即分档<br>step2:合同即法律<br>step3:造完真验<br>step4:交付有回执<br>step5:kernel-contract-a20 | — |
| gp_anchor_enforcement | staff_app | line00 | active | — | .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh |
| line_health | staff_app | line00 | active | — | — |
| skill_acceptance | staff_app | line00 | deprecated | — | — |
| customer_management | staff_app | line10 | active | — | .github/workflows/scripts/smoke/customer-admin-backend-smoke.sh |
| collaborative_docs | staff_app | line11 | proposed | — | — |
| knowledge_experience_qa | staff_app | line11 | proposed | step1:经验被留住（人侧自动触发 + agent 干完自动写回，「最近沉淀」立刻可见）<br>step2:问得到（大白话提问，答案带出处；「库里没有」与「暂时查不了」两种明确回答）<br>step3:干活前被喂到（agent 开工强制注入仍然成立的经验，中台可见注入台账） | — |
| org_context_switch | staff_app | line11 | proposed | — | — |
| structured_workbench | staff_app | line11 | proposed | step1:建得出表(自定义字段+组织归属+模板起步+表级可见性)<br>step2:数据进得来(行内编辑+冲突可见+粘贴导入+详情面板+回收站+JSON导出)<br>step3:视图切得开(筛/排/表格↔看板拖拽/视图偏好记住你)<br>step4:关联连得上(Relation+反向可见+引用不悬空) | — |

## Surfaces

- android
- api
- web
- windows

## Editions

- personal_wechat
- wecom
