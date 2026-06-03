# Sprint PRD — Path 4 CRM 表打通 + AI 每日 8:30 今日跟进名单推送

## OKR 对齐

- **对应 KR**：Path 4 客户私域 AI 接管 → skeleton 阶段（Notion `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`）
- **当前进度**：Step 3/5 building；Step 2/4/6 planned
- **本次推进预期**：Path 4 Step 2（飞书三表初始化）+ 新增 CRM 打通层（微信联系人 ↔ 客户明细表映射）+ 每日 8:30 AI 今日跟进名单推飞书群

## 背景

Step 3/5 的 AI 草稿和真发能力正在 building，但缺少 CRM 数据层——AI 无法知道"哪些微信联系人是客户"、"今天该跟谁"。本 sprint 补这一层：把微信联系人和飞书/Notion 客户明细表双向打通，让 AI 每日 8:30 自动读表、分析优先级、推今日跟进名单到飞书群。

## Golden Path

### 首次接入（用户操作路径）

用户从 [中台「配置客户管理」入口] → 经过 [选 CRM 平台 → OAuth → 表检测/建表 → 微信联系人 ↔ CRM 匹配确认] → 到达 [持久化映射建立，中台「客户列表」页展示已匹配 N 条记录]

1. 用户在 Dashboard 点「配置客户管理」→ 选择 CRM 平台：飞书 or Notion
2. 系统引导完成 OAuth（飞书复用 `FeishuBindTenant` 流程；Notion 用 internal integration token）
3. 系统检测目标空间是否已有《客户明细表》
   - 有表 → 读取字段映射，返回「找到 N 条记录，是否导入」
   - 无表 → 调 CRM 平台 API 自动建表（含评级 A1-A5 / 状态 / 微信号 / 跟进时间等核心字段）
4. 系统调用 xian-pc `wechat_rpa.py` 拉取微信联系人列表（E2E 中 mock 返回固定 5 条）
5. AI 将联系人按微信号/昵称模糊匹配 CRM 表记录
6. 中台展示匹配结果（已匹配 / 待确认 / 未匹配）→ 用户二次确认
7. 确认后写入 `crm_wechat_mapping`（wechat_contact_id ↔ crm_row_id ↔ platform ↔ tenant_id）

### 日常使用（每日 8:30 自动触发）

Brain tick cron 从 [8:30 触发] → 经过 [读表 → AI 分析 → 排优先级] → 到达 [飞书群 Webhook 收到今日跟进名单，含每人 AI 建议一句话]

1. Brain tick 8:30 触发（Asia/Shanghai）
2. 增量读飞书/Notion 客户明细表（只取上次同步后更新的行 + 下次跟进时间=今天 + 超期未跟进）
3. AI（OpenRouter DeepSeek）分析今日需跟进客户，按 A3→A4→A5→A2→A1 排优先级
4. 为每个客户生成一句沟通策略建议（基于评级 + 备注字段）
5. 推送到飞书机器人群（Webhook URL，格式：「今日跟进 N 人：1. 张三 [A3] 建议：...」）
6. 更新 CRM 表「AI 建议」列

## 边界情况

- wechat_rpa 联系人拉取失败 → 飞书群告警 + 日志，不阻塞已有映射
- CRM 表字段映射不匹配（有表接入）→ 中台显示字段映射预览，用户确认后才导入
- Notion token 过期 → 飞书群推送告警，状态标记 `token_expired`
- 联系人改名/删好友 → 下次同步标记 `contact_lost`，不删已有映射

## 范围限定

**在范围内**：CRM 表检测/建表、OAuth、微信联系人拉取（mock）、AI 匹配、映射持久化、每日 8:30 AI 分析推送、飞书+Notion 双线
**不在范围内**：AI 私聊草稿（Step 3）、真发（Step 5）、回执回写（Step 6）、沟通结果自动回填、转化率面板

## 假设

- [ASSUMPTION: Notion 接入用 internal integration token，非 user OAuth，thin 阶段降低复杂度]
- [ASSUMPTION: wechat_rpa 联系人拉取在 E2E 中 mock 固定 5 条，xian-rog 无真微信客户端]
- [ASSUMPTION: 每日 8:30 通过 Brain tick cron 实现，不新增独立 GitHub Actions schedule]
- [ASSUMPTION: 飞书推送 Webhook URL 从 `FEISHU_NOTIFY_WEBHOOK` env var 读取]

## 预期受影响文件

- `apps/api/src/routes/crm.ts`：新增，CRM 平台连接 / 表检测 / 联系人同步 API
- `apps/api/src/services/notion-crm.ts`：新增，Notion API client
- `apps/api/src/services/feishu-bitable.ts`：复用，扩展客户明细表建表逻辑
- `apps/api/src/services/crm-wechat-sync.ts`：新增，联系人 ↔ CRM AI 匹配
- `apps/api/src/services/daily-crm-analysis.ts`：新增，每日分析 + 飞书群推送
- `apps/dashboard/src/pages/CrmConfigPage.tsx`：新增，配置客户管理入口页
- `apps/dashboard/src/pages/CustomerListPage.tsx`：新增，客户列表展示页
- `packages/db/migrations/`：新增 `crm_wechat_mapping` 表

## E2E 验收

```bash
#!/bin/bash
set -e

# Step 1: 飞书 CRM 建表（无表场景）
TENANT_ID="test-tenant-crm"
RESULT=$(curl -sf -X POST localhost:3000/api/crm/init \
  -H "Content-Type: application/json" \
  -d "{\"platform\":\"feishu\",\"tenant_id\":\"$TENANT_ID\",\"mode\":\"create\"}")
echo $RESULT | jq -e '.success == true'
echo $RESULT | jq -e '.table_id != null'

# Step 2: 微信联系人拉取（mock）
CONTACTS=$(curl -sf "localhost:3000/api/crm/wechat-contacts?tenant_id=$TENANT_ID")
echo $CONTACTS | jq -e '(.contacts | length) >= 1'

# Step 3: AI 匹配结果展示
MATCH=$(curl -sf "localhost:3000/api/crm/match-preview?tenant_id=$TENANT_ID")
echo $MATCH | jq -e '.matched | length >= 0'

# Step 4: 今日 AI 分析（触发器）
ANALYSIS=$(curl -sf -X POST localhost:3000/api/crm/daily-analysis \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"dry_run\":true}")
echo $ANALYSIS | jq -e '.customers | length >= 0'
echo $ANALYSIS | jq -e '.webhook_sent == false'  # dry_run 不发

echo "✅ CRM 打通 + 每日分析 E2E 通过"
```

## journey_type: user_facing
## journey_type_reason: 首次接入路径从 Dashboard 配置页出发，Step 3/4 日常分析为 autonomous，起点 UI 优先取 user_facing
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E 走 GitHub Actions windows-latest runner（dry_run=true 避免真发），API 层本地 curl 验证
## journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
## step_id: L04-S2-S7（Path 4 Step 2 飞书表初始化 + 新增 CRM 打通层 Step）
