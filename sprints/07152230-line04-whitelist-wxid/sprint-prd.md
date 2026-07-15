# Sprint PRD：Line04 白名单匹配改用 wxid 稳定标识符

task_id: 2f98e00d-5d5c-4ce3-9911-00610d4ea5aa
journey_type: line04_cs_reply
target_environment: windows_cloud
created_at: 2026-07-15

---

## 背景与问题陈述

`listen_chat.py` 中 `cs_config_gate.should_reply()` 以 `sender_name`（微信会话列表标题文字）做名单匹配——"有备注显示备注、无备注显示昵称"，属于不稳定字符串。客户给联系人改备注后，旧存档名与当前显示名对不上，导致：

- 白名单模式：该放行的被拦
- 黑名单模式：该屏蔽的漏过

误判为静默丢包，用户无感知。

**修复方向**（用户 2026-07-15 确认）：以 wxid 为唯一匹配键，显示名仅用于人看的展示；wxid 仅在联系人首次建档时读取一次存入 `crm_customers.wechat_id`，后续匹配优先走 wxid，读不到则降级显示名。

---

## Invariant 约束

| # | 约束 | 不可绕过原因 |
|---|------|-------------|
| I-1 | `should_reply` 若 wxid 命中 → 直接返回，不再走显示名比较 | 避免改备注后再次误判 |
| I-2 | wxid 为空（`None`/`""`）时必须降级走显示名逻辑，不得直接返回 False | 旧数据/读取失败场景不能全部挂掉 |
| I-3 | `_read_contact_wechat_id` 只在首次建档时调用，不在每条消息处理中重复调用 | 打开资料卡属重操作，重复调用会拖慢回复链路 |
| I-4 | 存量 `wechat_id=NULL` 的 `crm_customers` 行匹配逻辑退回显示名，不得因本次改动导致这些行全部失配 | 存量数据保护 |
| I-5 | 黑名单/白名单语义不变，只是匹配 key 升级 | 不改接管模式逻辑，仅改身份解析入口 |

---

## 累积 FR

> 本 sprint 是 Line04 首次引入 wxid 作为接管匹配键。无前序累积 FR，以下为本 sprint 新增。

| FR-ID | 描述 | 厚度 | 验收方法 |
|-------|------|------|---------|
| FR-01 | 联系人首次建档（好友扫描/首次消息触发）时调用 `_read_contact_wechat_id`，结果写入 `crm_customers.wechat_id` | thin | 单测 mock + smoke psql 查 |
| FR-02 | `cs_config_gate.should_reply(config, sender_name, sender_wxid=None)` 新增 `sender_wxid` 参数；wxid 非空时优先匹配白/黑名单中的 wxid 字段；wxid 为空时降级走现有显示名逻辑 | thin | 单测覆盖 wxid 命中、wxid 为空降级两路径 |
| FR-03 | `listen_chat.py` 调用 `should_reply` 时传入从 `crm_customers` 查到的 `sender_wxid`；查询入口：按 `(cs_wechat_id, contact)` 取 `wechat_id` | thin | smoke 验 SQL join 字段回传 |
| FR-04 | 白/黑名单存储结构支持 wxid 字段（后端 API `wechat_cs_account_config` 的 whitelist/blacklist 列表元素从纯字符串升级为 `{name, wxid?}` 对象，向后兼容纯字符串条目） | thin | 单测老格式/新格式各一条 |
| FR-05 | 真机场景：给联系人改备注后，白名单匹配结果不受影响 | thin | smoke 断言（API 等价：改 contact 字段，不改 wechat_id，should_reply 结果不变） |

---

## Golden Path（4 步）

```
Step 1  好友扫描建档
         → agent scan → _read_contact_wechat_id → POST /api/crm/contacts/upsert
         → crm_customers.wechat_id 写入非空值
         ↑ E2E 断言：SELECT wechat_id FROM crm_customers WHERE contact='测试联系人' → 非空

Step 2  CRM 白名单配置写入 wxid
         → PUT /api/wechat/cs/config { whitelist: [{name:'测试联系人', wxid:'wxid_xxx'}] }
         → 200 OK

Step 3  消息触发接管判定 → wxid 优先匹配
         → listen_chat 收消息 → 按 (cs_wechat_id, contact) 查 crm_customers.wechat_id
         → should_reply(config, sender_name='测试联系人_改后备注', sender_wxid='wxid_xxx') → True
         ↑ E2E 断言：黑名单/白名单命中路径均 via wxid，不受 sender_name 变化影响

Step 4  wxid 读取失败降级
         → _read_contact_wechat_id 返回 None → should_reply 走显示名旧逻辑
         ↑ 单测断言：sender_wxid=None 时与旧行为一致
```

---

## NFR

| 类别 | 要求 |
|------|------|
| 性能 | `_read_contact_wechat_id` 不在消息处理热路径调用；仅在建档时调用一次，超时兜底 ≤3s |
| 向后兼容 | whitelist/blacklist 列表中纯字符串条目（旧格式）继续视为 `{name: entry, wxid: null}` 处理，不报错 |
| 数据安全 | `wechat_id` 写入前去除空白字符；空串写为 NULL |
| 测试覆盖 | `cs_config_gate.should_reply` 单测覆盖：wxid 命中 / wxid 未命中降级显示名 / wxid=None 全降级 / 旧格式兼容 共 4 条 |
| CI | 本 PR 不得破坏 `golden-path-1-smoke.sh` 任何已通过步骤；Path 4 smoke 同步补回归断言 |

---

## 文件变更预期

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/agent/wechat-rpa/cs_config_gate.py` | modify | `should_reply` 加 `sender_wxid` 参数，优先 wxid 匹配 |
| `services/agent/wechat-rpa/listen_chat.py` | modify | 消息处理传 `sender_wxid`；建档路径确认 wxid 写入 |
| `apps/api/src/routes/wechat/cs/config.ts`（或对应路由） | modify | whitelist/blacklist 元素结构支持 `{name, wxid?}` |
| `apps/api/db/migrations/YYYYMMDD_wxid_whitelist_compat.sql` | new | 如需 schema 变更（当前 crm_customers.wechat_id 已存在，可能无需迁移） |
| `services/agent/wechat-rpa/tests/test_cs_config_gate.py` | new/modify | 4 条单测 |
| `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | modify | 补 wxid 匹配回归断言（API 等价） |

---

## 存量数据兼容说明

- `crm_customers.wechat_id` 列已存在（`20260624_210000_create_crm_customers.sql`），默认可 NULL。
- 存量行 `wechat_id=NULL` → `should_reply` 接收 `sender_wxid=None` → 触发降级路径 → 与现有行为完全一致。
- 不需要 backfill 旧数据；wxid 随后续建档/消息触发自然补全。

---

## E2E smoke 断言（commit-1 先写）

```bash
# golden-path-4-smoke.sh 新增段落
# Step-wxid-1: 建档后 wechat_id 写入
WXID=$(psql "$DB_URL" -tAc "SELECT wechat_id FROM zenithjoy.crm_customers WHERE contact='smoke_test_contact' LIMIT 1")
[ -n "$WXID" ] || { echo "FAIL: wechat_id not written on first contact registration"; exit 1; }

# Step-wxid-2: 改显示名后 should_reply 不变（API 等价断言）
REPLY=$(curl -s -X POST "$API_URL/api/wechat/cs/should-reply-check" \
  -H "Content-Type: application/json" \
  -d '{"sender_name":"改后备注","sender_wxid":"'"$WXID"'","cs_wechat_id":"smoke_cs"}')
echo "$REPLY" | grep -q '"should_reply":true' || { echo "FAIL: wxid match failed after name change"; exit 1; }

# Step-wxid-3: wxid 为空时降级走显示名（回归）
REPLY2=$(curl -s -X POST "$API_URL/api/wechat/cs/should-reply-check" \
  -H "Content-Type: application/json" \
  -d '{"sender_name":"白名单用户","sender_wxid":null,"cs_wechat_id":"smoke_cs"}')
echo "$REPLY2" | grep -q '"should_reply":true' || { echo "FAIL: fallback to display name failed"; exit 1; }
```

---

journey_type: line04_cs_reply
target_environment: windows_cloud
