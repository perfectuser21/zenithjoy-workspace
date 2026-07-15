# Contract Draft：Line04 白名单匹配改用 wxid 稳定标识符

sprint_dir: sprints/07152230-line04-whitelist-wxid
task_id: 2f98e00d-5d5c-4ce3-9911-00610d4ea5aa
status: draft
created_at: 2026-07-15

---

## 背景摘要

`cs_config_gate.should_reply()` 当前以 `sender_name`（微信会话列表显示名）做名单匹配。
显示名随备注变化不稳定，改备注后匹配断裂导致白名单放行失效/黑名单漏过。
本 sprint 将匹配键升级为 wxid（微信唯一 ID），显示名仅用于人看的展示，并完整保留存量降级路径。

---

## 铁律映射

| 铁律 | PRD Invariant | 合同断言 |
|------|--------------|---------|
| wxid 优先匹配 | I-1 | BEHAVIOR-1 |
| 降级兼容（wxid 空时走显示名） | I-2 | BEHAVIOR-2 |
| 建档时机（只建档时读一次） | I-3 | BEHAVIOR-3 |
| crm_customers.wechat_id 写入 | FR-01 | BEHAVIOR-4 |
| 存量数据不受影响（wechat_id=NULL） | I-4 | BEHAVIOR-5 |

---

## E2E 验收

### Step 1 — 建档写入 wxid（DB 断言）

**场景**：好友扫描或首条消息触发首次建档，调用 `_read_contact_wechat_id`，结果写入 `crm_customers.wechat_id`。

**断言**：
```bash
WXID=$(psql "$DB_URL" -tAc "SELECT wechat_id FROM zenithjoy.crm_customers WHERE contact='smoke_test_contact' LIMIT 1")
[ -n "$WXID" ] || { echo "FAIL: wechat_id not written on first contact registration"; exit 1; }
```

**判定**：`wechat_id` 字段非空（非 NULL、非空串）。

---

### Step 2 — 改显示名后 should_reply 不变（wxid 优先匹配，API 等价断言）

**场景**：联系人白名单条目含 `wxid`，联系人显示名（备注）已变更为 `改后备注`，`sender_wxid` 仍为原 wxid。

**断言**：
```bash
REPLY=$(curl -s -X POST "$API_URL/api/wechat/cs/should-reply-check" \
  -H "Content-Type: application/json" \
  -d "{\"sender_name\":\"改后备注\",\"sender_wxid\":\"$WXID\",\"cs_wechat_id\":\"smoke_cs\"}")
echo "$REPLY" | grep -q '"should_reply":true' || { echo "FAIL: wxid match failed after name change"; exit 1; }
```

**判定**：`should_reply` 返回 `true`，即使 `sender_name` 与白名单存档名不一致。

---

### Step 3 — wxid 为空时降级走显示名（存量兼容回归）

**场景**：`sender_wxid=null`，`sender_name` 在白名单中，走旧显示名逻辑。

**断言**：
```bash
REPLY2=$(curl -s -X POST "$API_URL/api/wechat/cs/should-reply-check" \
  -H "Content-Type: application/json" \
  -d "{\"sender_name\":\"白名单用户\",\"sender_wxid\":null,\"cs_wechat_id\":\"smoke_cs\"}")
echo "$REPLY2" | grep -q '"should_reply":true' || { echo "FAIL: fallback to display name failed"; exit 1; }
```

**判定**：`should_reply` 返回 `true`，存量显示名匹配路径不中断。

---

### Step 4 — 黑名单模式下 wxid 优先排除

**场景**：`takeover_mode=blacklist`，黑名单条目含 `wxid`，`sender_wxid` 命中黑名单，即使 `sender_name` 不在黑名单串里。

**断言（单测等价，真机段 TODO）**：
```python
cfg = {"takeover_mode": "blacklist", "blacklist": [{"name": "小号备注", "wxid": "wxid_blocked"}]}
assert gate.should_reply(cfg, "随便什么名", sender_wxid="wxid_blocked") is False
assert gate.should_reply(cfg, "真客户", sender_wxid="wxid_legit") is True
```

**判定**：wxid 命中黑名单时返回 False，不受 sender_name 影响。

---

### Step 5 — 旧格式白名单（纯字符串）向后兼容

**场景**：whitelist 列表元素为纯字符串（旧格式），不含 `wxid` 字段。

**断言（单测）**：
```python
cfg = {"whitelist": ["老客户甲", "老客户乙"]}
assert gate.should_reply(cfg, "老客户甲", sender_wxid=None) is True
assert gate.should_reply(cfg, "路人", sender_wxid=None) is False
```

**判定**：旧格式条目继续正常工作，不报错，不全量失配。

---

## 单测覆盖要求（与实现同步，commit-2 完成）

| 测试用例 | 覆盖路径 |
|---------|---------|
| `test_should_reply_wxid_match_whitelist` | wxid 命中白名单 → True |
| `test_should_reply_wxid_fallback_to_name` | wxid=None → 降级显示名 → True |
| `test_should_reply_wxid_none_no_match` | wxid=None + 名字不在名单 → False |
| `test_should_reply_old_format_compat` | 纯字符串旧格式 → 兼容 |
| `test_should_reply_wxid_blacklist_exclude` | wxid 命中黑名单 → False |
| `test_should_reply_wxid_overrides_name_change` | 改名后 wxid 仍命中 → True（核心场景） |

---

## 未覆盖真实链路清单

| 编号 | 真实链路段 | 原因 | 等价断言方式 |
|------|-----------|------|-------------|
| U-1 | `_read_contact_wechat_id` 真机打开资料页读 wxid | xian-rog 真机 RPA 操作，CI 沙箱无法自动化 | 单测 mock `_read_contact_wechat_id` 返回值；smoke psql 验 wechat_id 写入（需预置数据） |
| U-2 | 联系人改备注后 listen_chat 实时收消息路径验证 | 需真机微信客户端 + 真实消息触发 | API 等价：`/api/wechat/cs/should-reply-check` 传 sender_name 不同 + sender_wxid 相同 → True |
| U-3 | `crm_customers.wechat_id` 首次建档写入（end-to-end scan 触发） | 需 agent_scan 真机跑 | psql 断言预置 smoke_test_contact 后验字段非空（要求 smoke 环境预置种子数据） |

---

## 文件变更对照

| 文件 | 变更 |
|------|------|
| `services/agent/wechat-rpa/cs_config_gate.py` | `should_reply` 加 `sender_wxid` 参数，wxid 非空时优先匹配 |
| `services/agent/wechat-rpa/listen_chat.py` | 消息处理传 `sender_wxid`；建档路径确认写 wechat_id |
| `apps/api/src/routes/wechat.ts` | whitelist/blacklist 元素支持 `{name, wxid?}` 格式 |
| `services/agent/wechat-rpa/tests/test_cs_config_gate.py` | 补 6 条 wxid 相关单测 |
| `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | 补 wxid 匹配回归断言段（3 步） |

---

## 开发顺序（TDD 强制）

```
commit-1：golden-path-4-smoke.sh 补 wxid 段 + test_cs_config_gate.py 补 6 条单测（此时全 FAIL）
commit-2：实现 cs_config_gate.py / listen_chat.py / wechat.ts，让 smoke + 单测通过
```
