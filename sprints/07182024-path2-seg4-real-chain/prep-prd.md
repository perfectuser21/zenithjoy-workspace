# PrepPRD：客户智能获客路径(Path2) — Seg1-4 服务端真实数据串联

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：golden-path-2-smoke.sh 新增一段，把 Step9/15 真实产出的 lead 接入
      真实 dispatch/build + dispatch/run，验证服务端从采集到派单是真实数据流而非各段独立造数据
- [ ] 另立 Sprint（本次不做）：真机自动化环境稳定性(e2e-line02-android-collect.yml 0/18)
- [ ] 待讨论：无

## Journey 当前状态
- ✅ 客户智能获客采集闭环（飞书文档画像→扩词→搜视频→抓评论者）— thin
- ✅ 抖音私信主动触达 — medium
- 🔄 本次：验证两者之间的数据流真实串联（不算新 Ability，是既有链路完整性补全）

## 本次要做的
在 golden-path-2-smoke.sh 里，紧接 Step 15（抓评论回填真实 douyin_id）之后，新增 Step 22：
把这条服务端刚产出的真实 lead 走一遍真实的 /dispatch/build + /dispatch/run，断言它被真实
挑中、生成真实 dm_assignment、派出真实 publish_task，且 device_platform 正确解析为 android
（复用 Step2 的 AGENT_PK + Step11 已同步的 capabilities）。

## Golden Path
1. 系统（承接 Step9/15）已产出一条 outreach_eligible=true 的真实 lead，带真实 douyin_id
2. 测试脚本 PATCH 该租户 dm_active_start=00:00/dm_active_end=23:59（避免时段闸导致 CI
   随机失败）→ 系统确认 200
3. 测试脚本 POST /api/acquisition/dispatch/build → 系统返回 assigned≥1
4. 测试脚本 POST /api/acquisition/dispatch/run → 系统派出 publish_tasks（task_type=dm_outreach）
5. 断言：publish_tasks.payload.douyin_id 等于 Step15 真实产出的号；device_platform='android'；
   dm_assignment_id 能回联到步骤3真实产出的 assignment（不是任何手动构造的 ID）

## 客户视角
客户填完获客画像、系统采集判定视频、抓到评论区真实抖音号后，系统会自动把这个人派进私信队列
——这条自动衔接不再只是"分段各自测过"，而是有测试真实证明"数据确实会自己流过去"。

## 完成后能
1. Path2 服务端段拥有第一条真正首尾相连的数据流验证（不再是Seg1-4分开测）
2. 下次再有人问"安卓获客链路通不通"，可以指向这条 CI 断言而不是翻手动验证记录

## 涉及的 Ability / Feature
- 客户智能获客采集闭环 + 抖音私信主动触达 — 补链路完整性验证，不改厚度分级

## 不包含
- 真机自动化通道稳定性（另立议题）
- Dashboard UI 改动（本次纯服务端+smoke）

## 判定点登记表
（本任务无接缝判定点，N/A——纯服务端已有真实端点组合验证，无新增模糊判断）

## 前置工作
### API 与凭据
- [x] 无新增外部凭据，全部复用 golden-path-2-smoke.sh 已有的 API_BASE/DB_URL

### 基础设施
- [x] apps/api 本地可起（已验证），Postgres 可连（已验证）

## 验收标准（Final E2E）
- [ ] golden-path-2-smoke.sh 新增 Step 22 全部通过
- [ ] 断言：dispatch/run 派出的 publish_task.payload.douyin_id 等于 Step15 真实产出的号
- [ ] 断言：device_platform='android'
- [ ] 断言：dm_assignment_id 回联到 dispatch/build 真实产出的 assignment（非硬编码）
- [ ] CI 全绿（不影响既有 Step1-21）
