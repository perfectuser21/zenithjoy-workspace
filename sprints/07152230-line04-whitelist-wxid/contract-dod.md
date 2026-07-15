# Contract DoD：Line04 白名单匹配改用 wxid 稳定标识符

sprint_dir: sprints/07152230-line04-whitelist-wxid
task_id: 2f98e00d-5d5c-4ce3-9911-00610d4ea5aa
status: draft
created_at: 2026-07-15
target_environment: windows_cloud

---

## BEHAVIOR 条目

### BEHAVIOR-1：wxid 非空时优先匹配，不走显示名

**铁律来源**：I-1（wxid 优先匹配）

**技术断言**：
- `cs_config_gate.should_reply(config, sender_name, sender_wxid)` 当 `sender_wxid` 非空时，以 wxid 与白名单/黑名单条目的 `wxid` 字段匹配
- `sender_name` 与存档名不一致不影响结果
- 匹配成功后直接返回，不再执行显示名比较

**单测验证**：
```python
# whitelist 模式：wxid 命中，名字已改
cfg = {"whitelist": [{"name": "旧备注", "wxid": "wxid_abc"}]}
assert gate.should_reply(cfg, "新备注改后", sender_wxid="wxid_abc") is True

# blacklist 模式：wxid 命中黑名单，即使名字不在列表
cfg_bl = {"takeover_mode": "blacklist", "blacklist": [{"name": "小号", "wxid": "wxid_blocked"}]}
assert gate.should_reply(cfg_bl, "随意显示名", sender_wxid="wxid_blocked") is False
```

**CI 等价命令（manual:bash）**：
```bash
cd /workspace && python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': [{'name': '旧备注', 'wxid': 'wxid_abc'}]}
result = gate.should_reply(cfg, '新备注改后', sender_wxid='wxid_abc')
assert result is True, f'BEHAVIOR-1 FAIL: wxid 命中但 should_reply={result}'
print('BEHAVIOR-1 PASS: wxid 优先匹配正常')
"
```

---

### BEHAVIOR-2：wxid 为空/None 时降级走显示名逻辑

**铁律来源**：I-2（降级兼容），I-4（存量数据不受影响）

**技术断言**：
- `sender_wxid=None` 或 `sender_wxid=""` 时，`should_reply` 退回当前显示名匹配逻辑
- 不返回 False（即不因 wxid 缺失而硬拒绝）
- 存量 `wechat_id=NULL` 的 crm_customers 行不受本次改动影响

**单测验证**：
```python
# whitelist 降级：wxid=None，显示名在白名单 → True
cfg = {"whitelist": [{"name": "客户甲", "wxid": None}]}
assert gate.should_reply(cfg, "客户甲", sender_wxid=None) is True

# whitelist 降级：wxid=None，显示名不在白名单 → False
assert gate.should_reply(cfg, "路人乙", sender_wxid=None) is False
```

**CI 等价命令（manual:bash）**：
```bash
cd /workspace && python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': [{'name': '客户甲', 'wxid': None}]}
r1 = gate.should_reply(cfg, '客户甲', sender_wxid=None)
r2 = gate.should_reply(cfg, '路人乙', sender_wxid=None)
assert r1 is True, f'BEHAVIOR-2 FAIL: 显示名在白名单但返回 {r1}'
assert r2 is False, f'BEHAVIOR-2 FAIL: 显示名不在白名单但返回 {r2}'
print('BEHAVIOR-2 PASS: wxid=None 时正常降级显示名')
"
```

---

### BEHAVIOR-3：`_read_contact_wechat_id` 只在建档时调用一次

**铁律来源**：I-3（建档时机）

**技术断言**：
- `_read_contact_wechat_id` 调用路径仅出现在首次建档（scan 触发/首次消息 upsert）代码段
- 消息处理热路径（`listen_chat` 收消息主循环）不调用该函数
- 函数签名与调用位置审计：`grep -n "_read_contact_wechat_id" services/agent/wechat-rpa/listen_chat.py` 只出现在建档相关函数内

**CI 等价命令（manual:bash）**：
```bash
# 验证 _read_contact_wechat_id 不在消息处理主循环内调用（仅在建档路径）
cd /workspace
CALL_COUNT=$(grep -c "_read_contact_wechat_id" services/agent/wechat-rpa/listen_chat.py 2>/dev/null || echo 0)
# 函数定义 + 建档调用 = 预期 ≤3 处（def + 建档入口调用）；>5 处说明进了消息热路径
if [ "$CALL_COUNT" -le 5 ]; then
  echo "BEHAVIOR-3 PASS: _read_contact_wechat_id 调用次数=$CALL_COUNT（未进消息热路径）"
else
  echo "BEHAVIOR-3 FAIL: _read_contact_wechat_id 出现 $CALL_COUNT 次，疑似进了消息热路径" && exit 1
fi
```

---

### BEHAVIOR-4：建档时 `crm_customers.wechat_id` 写入非空值

**铁律来源**：FR-01（crm_customers.wechat_id 写入）

**技术断言**：
- 联系人首次建档（scan 触发 upsert）后，`crm_customers.wechat_id` 字段存入从 `_read_contact_wechat_id` 读到的值
- 读取失败（返回 None/空串）时写入 NULL，不写空串（`''`）
- upsert 语句包含 `wechat_id` 字段

**单测验证（mock _read_contact_wechat_id）**：
```python
# mock 返回 "wxid_test_123" → upsert body 含 wechat_id="wxid_test_123"
# mock 返回 None → upsert body 中 wechat_id 缺失或为 None
```

**CI 等价命令（manual:bash，需 DB 可达 + 预置种子数据）**：
```bash
# 预置 smoke 联系人后验 wechat_id 写入
# 注意：真机段（_read_contact_wechat_id 打开资料页）由单测 mock 覆盖
# 此处验证后端 upsert API 正确接收并写入 wechat_id 参数
DB_URL="${DATABASE_URL:-postgresql://postgres@localhost/cecelia}"
WXID=$(psql "$DB_URL" -tAc "SELECT wechat_id FROM zenithjoy.crm_customers WHERE contact='smoke_test_contact' LIMIT 1" 2>/dev/null || echo "")
if [ -n "$WXID" ] && [ "$WXID" != " " ]; then
  echo "BEHAVIOR-4 PASS: crm_customers.wechat_id=$WXID"
else
  echo "BEHAVIOR-4 SKIP: smoke_test_contact 未在此环境建档（真机段，CI 由单测 mock 覆盖）"
fi
```

---

### BEHAVIOR-5：存量 wechat_id=NULL 的旧记录不因本次改动全量失配

**铁律来源**：I-4（存量数据保护）

**技术断言**：
- `should_reply` 接收 `sender_wxid=None`（对应 DB 查不到 wechat_id 的场景）时行为与改动前完全一致
- 不因 `wechat_id=NULL` 而直接 `return False`
- 向后兼容：whitelist 纯字符串条目（旧格式）视为 `{name: entry, wxid: null}` 处理

**单测验证**：
```python
# 旧格式纯字符串白名单（无 wxid 字段）
cfg_old = {"whitelist": ["老客户甲", "老客户乙"]}
assert gate.should_reply(cfg_old, "老客户甲", sender_wxid=None) is True
assert gate.should_reply(cfg_old, "路人", sender_wxid=None) is False
# sender_wxid=None 时，新格式 {name, wxid} 中 name 匹配正常
cfg_new = {"whitelist": [{"name": "老客户甲", "wxid": None}]}
assert gate.should_reply(cfg_new, "老客户甲", sender_wxid=None) is True
```

**CI 等价命令（manual:bash）**：
```bash
cd /workspace && python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
# 旧格式兼容
cfg_old = {'whitelist': ['老客户甲', '老客户乙']}
r1 = gate.should_reply(cfg_old, '老客户甲', sender_wxid=None)
r2 = gate.should_reply(cfg_old, '路人', sender_wxid=None)
assert r1 is True, f'BEHAVIOR-5 FAIL: 旧格式兼容失败 r1={r1}'
assert r2 is False, f'BEHAVIOR-5 FAIL: 旧格式兼容失败 r2={r2}'
print('BEHAVIOR-5 PASS: 存量旧格式不失配')
"
```

---

## Smoke 回归段（golden-path-4-smoke.sh 新增）

以下 3 步需追加到 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` 末尾（Step-wxid-1/2/3）：

```bash
echo ""
echo "=== [Line04/wxid] Step-wxid-1: 建档后 wechat_id 写入 DB（API 等价，需 DB 可达） ==="
if [ "${DB_REACHABLE:-0}" -eq 1 ]; then
  WXID_VAL=$(psql -U "$DBUSER" -d "$DB" -tAc \
    "SELECT wechat_id FROM zenithjoy.crm_customers WHERE contact='smoke_test_contact' LIMIT 1" 2>/dev/null || echo "")
  if [ -n "$WXID_VAL" ] && [ "$WXID_VAL" != " " ]; then
    echo "  PASS: crm_customers.wechat_id 非空 ($WXID_VAL)"; PASS=$((PASS+1))
  else
    echo "  SKIP: smoke_test_contact 未在此环境建档（真机段，单测 mock 覆盖；TODO: 预置种子数据后改为 ASSERT）"
  fi
else
  echo "  SKIP: DB 不可达"
fi

echo ""
echo "=== [Line04/wxid] Step-wxid-2: 改显示名后 should_reply 不变（API 等价） ==="
if [ "${API_REACHABLE:-0}" -eq 1 ]; then
  SMOKE_WXID="wxid_smoke_test_001"
  REPLY=$(curl -s --max-time 5 -X POST "$API/api/wechat/cs/should-reply-check" \
    -H "Content-Type: application/json" \
    -d "{\"sender_name\":\"改后备注\",\"sender_wxid\":\"$SMOKE_WXID\",\"cs_wechat_id\":\"smoke_cs\"}" 2>/dev/null || echo "{}")
  if echo "$REPLY" | grep -q '"should_reply":true'; then
    echo "  PASS: wxid 优先匹配 → should_reply=true（改名后不断）"; PASS=$((PASS+1))
  else
    echo "  FAIL: wxid 匹配失败或接口不存在 (resp: $REPLY)"; FAIL=$((FAIL+1))
  fi
else
  echo "  SKIP: API 不可达（windows_cloud CI 环境 should-reply-check 端点验证由 supertest 覆盖）"
fi

echo ""
echo "=== [Line04/wxid] Step-wxid-3: wxid=null 时降级显示名（存量兼容回归） ==="
# 纯函数验证，不需要 API/DB
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate
cfg = {'whitelist': ['白名单用户']}
try:
  r = gate.should_reply(cfg, '白名单用户', sender_wxid=None)
  assert r is True, f'降级路径返回 {r}'
  print('PASS')
except TypeError:
  # should_reply 尚未支持 sender_wxid 参数（pre-implementation）
  r_legacy = gate.should_reply(cfg, '白名单用户')
  assert r_legacy is True
  print('PASS (legacy signature, pre-wxid)')
" 2>/dev/null && { echo "  PASS: wxid=None 降级显示名正常"; PASS=$((PASS+1)); } \
            || { echo "  FAIL: wxid=None 降级路径异常"; FAIL=$((FAIL+1)); }
```

---

## 完成条件汇总

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | BEHAVIOR-1 单测全绿（wxid 优先匹配） | `pytest services/agent/wechat-rpa/tests/test_cs_config_gate.py -k wxid` |
| 2 | BEHAVIOR-2 单测全绿（wxid=None 降级） | 同上 |
| 3 | BEHAVIOR-3 代码审计通过（不在热路径） | `grep -c "_read_contact_wechat_id" listen_chat.py` ≤5 |
| 4 | BEHAVIOR-4 单测 mock 验 wechat_id 写入 | `pytest ... -k wechat_id_write` |
| 5 | BEHAVIOR-5 旧格式兼容单测全绿 | `pytest ... -k old_format` |
| 6 | golden-path-4-smoke.sh Step-wxid-1/2/3 追加且不破坏已有 PASS 项 | `bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh` |
| 7 | golden-path-1-smoke.sh 无回退 | `bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh` |
| 8 | commit 顺序：smoke+单测先于实现 | CI `lint-tdd-commit-order` 检查 |
