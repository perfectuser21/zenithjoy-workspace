# Path 4 Sprint 1 Lead Acceptance — 客户私域 AI 接管 thin 第一刀

> Sprint 1 目标：把 PoC（xian-pc 桌面 wechat_bot.py / wechat_rpa.py）重写进 zenithjoy repo，
> 接 OpenRouter DeepSeek + 飞书 Bitable + zenithjoy-agent 协议，完成 6 step 端到端 thin 骨架。
> Lead 自验在 rog-xian + REAL_PUBLISH=1 真扫码 + 真发完成（不可 mock）。

- **Sprint**: Path 4 Sprint 1（thin 第一刀）
- **Worker Machine**: rog-xian (Tailscale 100.98.253.95, hostname XX-ROG, USER=asus, USERPROFILE=C:\Users\asus)
- **Agent 部署路径**: `~/zenithjoy-agent/`（已有，含 .env / build / publishers）
- **Lead**: 用户 RDP 到 rog 真扫码 + Claude Code 自动化编排
- **Date**: <2026-MM-DD 待 sprint 完成填>
- **Branch**: cp-05082012-path4-sprint-1-prd
- **Validation Mode**: 模板阶段 LEAD_ACCEPTANCE_VALIDATION=skip / Final merge LEAD_ACCEPTANCE_VALIDATION=strict

---

## Checklist

### 前置（部署）
- [ ] ssh rog-xian 通（Tailscale 100.98.253.95 active）
- [ ] `bash scripts/deploy-agent-to-rog.sh` 部署最新 agent 到 rog `~/zenithjoy-agent/`
- [ ] rog 上 `pip install -r services/agent/wechat-rpa/requirements.txt` 通
- [ ] rog 上 PC 微信客户端已装且未登录任何号
- [ ] rog 上 chrome:19333 已加载 zenithjoy Dashboard 登录态

### Step 1 — 扫码绑个微干净测试号
- [ ] 用户 RDP 到 rog → 打开 Dashboard → AgentMachines 卡片选 rog → 点"绑定微信" → 选"个人微信"
- [ ] PC 微信客户端真弹码 + Lead 用手机扫码 + 微信客户端真登录
- [ ] Agent 回报中台 → Dashboard 该 agent 微信绑定状态变 `bound` + 显示真昵称
- [ ] DB `agent_platform_sessions` 新增一行 `platform=wechat_personal, status=bound`

### Step 2 — 飞书 Bitable 4 表自动初始化
- [ ] 客户登录飞书空间 → 看到 4 张新表（客户档案 / 营销画像 / 内容排期 / 互动记录）
- [ ] 在客户档案表手填 3-5 个真实测试客户（含真实微信号 + 行业）
- [ ] 在营销画像表填 3 字段（行业 / 受众 / 钩子文案）

### Step 3 — 私聊客户 → AI 草稿写飞书
- [ ] 用 Lead 自己的另一个微信小号（已加为绑定号好友 + 在客户档案表名单内）发一条真实消息（如"在吗"）
- [ ] Agent 监听到 → 调 OpenRouter DeepSeek 生成回复草稿 → 写飞书互动记录表（pending_review）
- [ ] 在飞书互动记录表能看到一行：[客户名] [客户原话] [AI 草稿] [pending_review]
- [ ] llm_audit DB 表能查到一条 DeepSeek 调用记录

### Step 4 — 朋友圈定时草稿
- [ ] 触发 `curl -X POST localhost:5200/api/wechat/scheduler-tick {force:true}`
- [ ] 飞书内容排期表新增一行朋友圈草稿（pending_review）
- [ ] 草稿内容真实包含画像信息（人工读一眼判断）

### Step 5 — 飞书审批 → 真发
- [ ] 在飞书内容排期表把朋友圈草稿状态改 `approved`
- [ ] 30 秒内 Agent 收到 task_dispatch → spawn send_moment.py REAL_PUBLISH=1
- [ ] PC 微信客户端真打开朋友圈 → 真发布到指定可见分组（"AI 测试"）
- [ ] Lead 用手机微信切到那个分组确认朋友圈真出现
- [ ] 同样流程在飞书互动记录表 approve 一条私聊草稿 → 真发到客户聊天框
- [ ] Lead 在另一个小号确认收到真私聊回复

### Step 6 — 回执回写飞书
- [ ] 飞书内容排期表对应行状态变 `published` + sent_at 时间戳
- [ ] 飞书互动记录表对应行状态变 `published` + 真发时间
- [ ] DB wechat_publish_task 对应行 receipt_status='success'

### 频控真验
- [ ] 24h 内尝试发第 2 条朋友圈（同号）→ 状态 `rate_limited` + next_allowed_at
- [ ] 1 分钟内连发 3 条私聊 → 第 3 条 rate_limited

### 安全护栏
- [ ] 名单外好友给绑定号发消息 → 飞书互动记录表无新增（消息被丢弃）

---

## Evidence

### 真 cookie / 登录态 dump（Step 1 后填，≥ 100 字节）
```
<待 Lead 自验后填入：rog 上 ~/zenithjoy-agent/wechat-session/<wechat_id>.json 的脱敏摘要>
cookie_size: <字节数>
```

### 真 wechat_id（Step 1 后填，非占位）
```
wechat_id: <待填，不能是 test_wechat_001 / placeholder>
nickname: <真实昵称>
```

### 真 sent_at（Step 5 后填，ISO8601）
```
moment_sent_at: <待填，2026-MM-DDTHH:MM:SS+08:00>
chat_sent_at: <待填，同格式>
```

### 真 feishu_record_id（Step 3/4/5 后填，rec...）
```
schedule_record_id: rec<待填>
interaction_record_id: rec<待填>
customer_record_id: rec<待填>
```

### 真扫码截图（Step 1）
- 文件: `.agent-knowledge/path-4/screenshots/sprint-1-step1-qr-scanned.png`
- 描述: rog 屏幕 PC 微信客户端登录成功状态

### 真发朋友圈截图（Step 5）
- 文件: `.agent-knowledge/path-4/screenshots/sprint-1-step5-moment-published.png`
- 描述: Lead 手机微信看到的真朋友圈（AI 测试分组）

### 真私聊截图（Step 5）
- 文件: `.agent-knowledge/path-4/screenshots/sprint-1-step5-chat-replied.png`
- 描述: Lead 另一个小号收到的真私聊回复

---

## Notes / Issues

<待 Lead 自验过程中发现的问题填入。常见类别：>
- wxauto4 兼容性（PC 微信新版本 className 变更等）
- pyautogui 操作时序（粘贴/点击间隔）
- 频控边界（睡眠 + 重连后 SQLite 状态是否正确）
- 飞书 OpenAPI quota / token 续期
- Agent SSE 断线重连

---

## Sprint 完成判据（Final merge gate）

LEAD_ACCEPTANCE_VALIDATION=strict 校验：
- [ ] cookie 字段 ≥ 50 字节非空
- [ ] wechat_id 非占位（不是 test_wechat_001 / placeholder）
- [ ] sent_at ISO8601 在 sprint 完成日 ±2 天内
- [ ] feishu_record_id 含 rec[A-Za-z0-9]{6,}
- [ ] 6 个 Step Checklist 全勾选 ✓
