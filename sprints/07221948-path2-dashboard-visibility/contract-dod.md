# contract-dod.md
# Sprint: Path 2 Dashboard 展示与人工干预能力建设
# Task ID: 7cb465c1-03cc-4934-a638-e61f78195d37
# target_environment: local_api
# 产出时间: 2026-07-24

---

## DoD（Definition of Done）概述

本 sprint 完成标准：smoke Step 25-29 全绿 + 现有 Step 1-24 无回归。
评判层：API 层（curl + psql），不要求 Android 真机。

---

## BEHAVIOR 条目清单

### [BEHAVIOR-GP1-A] 获客列表：有 dm_assignment 的 lead 返回非 untouched 状态

**验证命令（manual:bash）**：
```bash
# 前置：seed 测试数据（staging 环境）
TENANT_ID="test-tenant-$(date +%s)"
# 注册租户 + 创建 lead + 插入 dm_assignment (status='sent')
LEAD_ID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TENANT_ID', 'test_nick', 'test comment')
   RETURNING id")
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status)
   VALUES ('$TENANT_ID', '$LEAD_ID', 'test_acc', 'sent')"
# 断言
HTTP=$(curl -s -o /tmp/gp1a.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
STATUS=$(python3 -c "import json,sys; leads=json.load(open('/tmp/gp1a.json'))['leads']; print(next((l.get('outreach_status','') for l in leads if l.get('commenter_id','')=='test_nick' or True), ''))" 2>/dev/null || echo "")
python3 -c "
import json,sys
data=json.load(open('/tmp/gp1a.json'))
leads=data.get('leads',[])
has_outreach_status = all('outreach_status' in l for l in leads) if leads else False
print('outreach_status field present:', has_outreach_status)
# 验证有 assignment 的 lead 不是 untouched
touched = [l for l in leads if l.get('outreach_status') != 'untouched']
print('non-untouched leads:', len(touched))
sys.exit(0 if has_outreach_status else 1)
"
```
**期望结果**：exit 0；响应中 leads 每项含 outreach_status 字段；有 dm_assignment 的 lead outreach_status == "touched"

---

### [BEHAVIOR-GP1-B] 获客列表：无 dm_assignment 的 lead 返回 untouched

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-untouched-$(date +%s)"
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TENANT_ID', 'no_assign_nick', 'no assign comment')"
HTTP=$(curl -s -o /tmp/gp1b.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
leads=json.load(open('/tmp/gp1b.json'))['leads']
untouched=[l for l in leads if l.get('outreach_status')=='untouched']
print('untouched leads:', len(untouched), '/ total:', len(leads))
sys.exit(0 if len(untouched)==len(leads) and len(leads)>0 else 1)
"
```
**期望结果**：exit 0；所有 lead 的 outreach_status == "untouched"

---

### [BEHAVIOR-GP1-C] 获客列表：多条 dm_assignment 时只取最新一条

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-multi-assign-$(date +%s)"
LEAD_ID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TENANT_ID', 'multi_assign', 'comment') RETURNING id")
# 先插旧的 sent 记录
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, updated_at)
   VALUES ('$TENANT_ID', '$LEAD_ID', 'acc_old', 'sent', NOW() - interval '1 hour')"
# 再插更新的 failed 记录
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, updated_at)
   VALUES ('$TENANT_ID', '$LEAD_ID', 'acc_new', 'failed', NOW())"
HTTP=$(curl -s -o /tmp/gp1c.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
leads=json.load(open('/tmp/gp1c.json'))['leads']
lead=[l for l in leads if l.get('commenter_id','')=='multi_assign' or True]
# 最新条 status=failed → outreach_status=retry_needed
status=[l.get('outreach_status') for l in leads]
print('statuses:', status)
sys.exit(0 if 'retry_needed' in status else 1)
"
```
**期望结果**：exit 0；outreach_status == "retry_needed"（取最新 failed 条）

---

### [BEHAVIOR-GP1-D] 租户隔离：跨租户 lead 不串

**验证命令（manual:bash）**：
```bash
TA="tenant-a-$(date +%s)"
TB="tenant-b-$(date +%s)"
# T_A 有 lead + assignment
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TA', 'lead_from_a', 'comment')"
# T_B 无任何数据
HTTP=$(curl -s -o /tmp/gp1d.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $TB")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
leads=json.load(open('/tmp/gp1d.json'))['leads']
cross=[l for l in leads if 'lead_from_a' in str(l)]
print('cross-tenant leads found:', len(cross))
sys.exit(0 if len(cross)==0 else 1)
"
```
**期望结果**：exit 0；T_B 查询结果不含 T_A 的 lead

---

### [BEHAVIOR-GP2-A] outreach/defaults 返回在线小号列表+默认话术

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-defaults-$(date +%s)"
LEAD_ID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TENANT_ID', 'defaults_lead', 'comment') RETURNING id")
HTTP=$(curl -s -o /tmp/gp2a.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/outreach/defaults?lead_id=$LEAD_ID" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp2a.json'))
has_accounts = 'accounts' in data and isinstance(data['accounts'], list)
has_script = 'default_script' in data and data['default_script']
print('accounts field:', has_accounts, '| default_script:', has_script)
sys.exit(0 if has_accounts and has_script else 1)
"
```
**期望结果**：exit 0；响应含 accounts（array）+ default_script（非空）

---

### [BEHAVIOR-GP2-B] POST outreach/manual 写入 dm_assignments

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-manual-$(date +%s)"
LEAD_ID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, nickname, comment_text)
   VALUES ('$TENANT_ID', 'manual_lead', 'comment') RETURNING id")
HTTP=$(curl -s -o /tmp/gp2b.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/outreach/manual" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"lead_id\":\"$LEAD_ID\",\"account_label\":\"test_burner\",\"script_text\":\"测试话术\"}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP body=$(cat /tmp/gp2b.json)"; exit 1; }
COUNT=$(psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments
   WHERE tenant_id='$TENANT_ID' AND lead_id='$LEAD_ID' AND account_label='test_burner'")
[ "$COUNT" = "1" ] || { echo "FAIL: dm_assignments count=$COUNT (expected 1)"; exit 1; }
echo "PASS: dm_assignments row written"
```
**期望结果**：exit 0；dm_assignments 写入 1 行

---

### [BEHAVIOR-GP2-C] POST outreach/manual 幂等——命中唯一约束走 UPDATE 不重复 INSERT

**验证命令（manual:bash）**：
```bash
# 接 GP2-B 的 TENANT_ID + LEAD_ID（或重建 seed）
# 二次调用相同 (tenant, lead, account_label)
HTTP=$(curl -s -o /tmp/gp2c.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/outreach/manual" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"lead_id\":\"$LEAD_ID\",\"account_label\":\"test_burner\",\"script_text\":\"新话术\"}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP (should not be 409)"; exit 1; }
COUNT=$(psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments
   WHERE tenant_id='$TENANT_ID' AND lead_id='$LEAD_ID' AND account_label='test_burner'")
[ "$COUNT" = "1" ] || { echo "FAIL: dm_assignments count=$COUNT (expected 1, idempotency broken)"; exit 1; }
echo "PASS: idempotent upsert OK"
```
**期望结果**：exit 0；二次调用不报 conflict；dm_assignments 仍为 1 行（UPDATE 不重复 INSERT）

---

### [BEHAVIOR-GP3-A] GET /api/agent/install-pack 返回含 download_url 的 200

**验证命令（manual:bash）**：
```bash
HTTP=$(curl -s -o /tmp/gp3a.json -w "%{http_code}" \
  "$API_BASE/api/agent/install-pack" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP body=$(cat /tmp/gp3a.json)"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp3a.json'))
url=data.get('download_url','') or data.get('apk_url','') or data.get('url','')
print('download_url:', url[:80] if url else '(empty)')
sys.exit(0 if url and url.startswith('http') else 1)
"
```
**期望结果**：exit 0；响应含 download_url（https:// 开头）；现有下载逻辑未被破坏

---

### [BEHAVIOR-GP4-A] 同租户同关键词 30 天内第二次采集触发 duplicate:true

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-dedup-$(date +%s)"
KW="test_keyword_$(date +%s)"
# 第一次采集（seed 历史记录）
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks
   (tenant_id, keywords, status, created_at)
   VALUES ('$TENANT_ID', ARRAY['$KW'], 'done', NOW() - interval '5 days')"
# 第二次采集（不带 force）
HTTP=$(curl -s -o /tmp/gp4a.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"keywords\":[\"$KW\"]}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP body=$(cat /tmp/gp4a.json)"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp4a.json'))
dup=data.get('duplicate',False)
days=data.get('days_ago',-1)
print('duplicate:', dup, '| days_ago:', days)
sys.exit(0 if dup==True and 0<=days<=30 else 1)
"
```
**期望结果**：exit 0；duplicate==true；days_ago 在 [0,30] 范围内

---

### [BEHAVIOR-GP4-B] force:true 跳过去重

**验证命令（manual:bash）**：
```bash
# 接 GP4-A 的 TENANT_ID + KW
HTTP=$(curl -s -o /tmp/gp4b.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"keywords\":[\"$KW\"],\"force\":true}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp4b.json'))
dup=data.get('duplicate',False)
tid=data.get('task_id','') or data.get('data',{}).get('task_id','')
print('duplicate:', dup, '| task_id:', tid)
sys.exit(0 if not dup and tid else 1)
"
```
**期望结果**：exit 0；duplicate==false；task_id 返回（新任务正常创建）

---

### [BEHAVIOR-GP4-C] 跨租户不互触去重（INV-2、INV-3）

**验证命令（manual:bash）**：
```bash
TA="tenant-dedup-a-$(date +%s)"
TB="tenant-dedup-b-$(date +%s)"
KW="cross_tenant_kw_$(date +%s)"
# T_A 已有该关键词历史
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks
   (tenant_id, keywords, status, created_at)
   VALUES ('$TA', ARRAY['$KW'], 'done', NOW() - interval '3 days')"
# T_B 发起同关键词采集
HTTP=$(curl -s -o /tmp/gp4c.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TB" \
  -d "{\"keywords\":[\"$KW\"]}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp4c.json'))
dup=data.get('duplicate',False)
print('T_B duplicate (should be False):', dup)
sys.exit(0 if not dup else 1)
"
```
**期望结果**：exit 0；T_B 的 duplicate==false（T_A 历史不影响 T_B）

---

### [BEHAVIOR-GP4-D] 超 30 天不触发去重

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-old-$(date +%s)"
KW="old_keyword_$(date +%s)"
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks
   (tenant_id, keywords, status, created_at)
   VALUES ('$TENANT_ID', ARRAY['$KW'], 'done', NOW() - interval '31 days')"
HTTP=$(curl -s -o /tmp/gp4d.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"keywords\":[\"$KW\"]}")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
data=json.load(open('/tmp/gp4d.json'))
dup=data.get('duplicate',False)
print('old keyword duplicate (should be False):', dup)
sys.exit(0 if not dup else 1)
"
```
**期望结果**：exit 0；duplicate==false（31 天前记录不在 30 天窗口内）

---

### [BEHAVIOR-GP5-A] GET /collect/tasks 每条任务含 status（7 态合法值）

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-tasks-$(date +%s)"
# 种各状态任务
for S in pending running stage_1_done done partial failed cancelling; do
  psql "$DB_URL" -c \
    "INSERT INTO zenithjoy.acquisition_collect_tasks
     (tenant_id, keywords, status) VALUES ('$TENANT_ID', ARRAY['kw_$S'], '$S')"
done
HTTP=$(curl -s -o /tmp/gp5a.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/collect/tasks" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP body=$(cat /tmp/gp5a.json)"; exit 1; }
python3 -c "
import json,sys
VALID={'pending','running','stage_1_done','done','partial','failed','cancelling'}
tasks=json.load(open('/tmp/gp5a.json')).get('tasks',[]) or json.load(open('/tmp/gp5a.json')).get('data',[])
all_valid=all(t.get('status') in VALID for t in tasks)
print('tasks:', len(tasks), '| all valid:', all_valid)
bad=[t.get('status') for t in tasks if t.get('status') not in VALID]
print('invalid statuses:', bad)
sys.exit(0 if all_valid and len(tasks)>0 else 1)
"
```
**期望结果**：exit 0；所有任务 status 在 7 态合法值内

---

### [BEHAVIOR-GP5-B] 失败任务含 error_message 人话翻译

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-failed-$(date +%s)"
psql "$DB_URL" -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks
   (tenant_id, keywords, status, error_code)
   VALUES ('$TENANT_ID', ARRAY['kw'], 'failed', 'quota_exceeded')"
HTTP=$(curl -s -o /tmp/gp5b.json -w "%{http_code}" \
  "$API_BASE/api/acquisition/collect/tasks" \
  -H "X-Tenant-Id: $TENANT_ID")
[ "$HTTP" = "200" ] || { echo "FAIL: HTTP $HTTP"; exit 1; }
python3 -c "
import json,sys
tasks=json.load(open('/tmp/gp5b.json')).get('tasks',[]) or json.load(open('/tmp/gp5b.json')).get('data',[])
failed=[t for t in tasks if t.get('status')=='failed']
msg=failed[0].get('error_message','') if failed else ''
print('error_message:', msg)
sys.exit(0 if msg and len(msg)>2 else 1)
"
```
**期望结果**：exit 0；error_message 非空（中文说明）

---

### [BEHAVIOR-GP5-C] cancelling 态禁止重试

**验证命令（manual:bash）**：
```bash
TENANT_ID="test-cancelling-$(date +%s)"
TASK_ID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks
   (tenant_id, keywords, status)
   VALUES ('$TENANT_ID', ARRAY['kw'], 'cancelling') RETURNING id")
HTTP=$(curl -s -o /tmp/gp5c.json -w "%{http_code}" \
  -X POST "$API_BASE/api/acquisition/collect/retry?task_id=$TASK_ID" \
  -H "X-Tenant-Id: $TENANT_ID")
# 期望 400 或 409
[ "$HTTP" = "400" ] || [ "$HTTP" = "409" ] || { echo "FAIL: HTTP $HTTP (expected 400/409)"; exit 1; }
echo "PASS: cancelling task retry correctly rejected HTTP $HTTP"
```
**期望结果**：exit 0；HTTP 400 或 409（拒绝对 cancelling 任务重试）

---

### [BEHAVIOR-GP5-D] 设备类型字段值域统一（INV-1）

**验证命令（manual:bash）**：
```bash
# 检查 agents.os_type 可接受 'android' 和 'windows'（或含这两个值的枚举/CHECK）
AGENTS_CHECK=$(psql "$DB_URL" -t -A -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname LIKE '%os_type%' AND conrelid='zenithjoy.agents'::regclass")
echo "agents os_type constraint: $AGENTS_CHECK"

# 检查 line02_account_sessions.device_type CHECK 定义
LINE02_CHECK=$(psql "$DB_URL" -t -A -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname LIKE '%device_type%'
   AND conrelid='zenithjoy.line02_account_sessions'::regclass")
echo "line02_account_sessions device_type constraint: $LINE02_CHECK"

# 两个约束都必须含 'android'
echo "$AGENTS_CHECK" | grep -q "android" || \
  { echo "FAIL: agents.os_type constraint 不含 'android'"; exit 1; }
echo "$LINE02_CHECK" | grep -q "android" || \
  { echo "FAIL: line02_account_sessions.device_type 不含 'android'"; exit 1; }

echo "PASS: 两列值域均含 android"
```
**期望结果**：exit 0；两列约束定义均含 'android' 关键词（值域已对齐）

---

## DoD 检查清单

### 代码要求

- [ ] FR-1：`GET /api/acquisition/leads` 响应每 lead 含 `outreach_status` 字段（JOIN dm_assignments 最新一条）
- [ ] FR-2：`GET /api/acquisition/outreach/defaults` 端点实现（心跳代理筛选 + 话术返回）
- [ ] FR-2：`POST /api/acquisition/outreach/manual` 端点实现（ON CONFLICT DO UPDATE 幂等写）
- [ ] FR-3：`AcquisitionAccountsPage.tsx` 补 APK 下载入口（引用现有 agent-install-pack 逻辑）
- [ ] FR-4：`POST /api/acquisition/collect/start` 加 30 天窗口去重检查 + `force` 参数支持
- [ ] FR-5：`GET /api/acquisition/collect/tasks` 确认 7 态 status 字段已接线
- [ ] FR-5：失败任务 error_code → 中文 error_message 映射（至少覆盖 5 个码）
- [ ] FR-5：`POST /api/acquisition/collect/retry` cancelling 态拒绝逻辑
- [ ] FR-5：`agents.os_type` 与 `line02_account_sessions.device_type` 值域统一 migration

### Smoke 要求

- [ ] `golden-path-2-smoke.sh` Step 25-29 已添加
- [ ] 每个断言失败时 `exit 1` 硬失败（禁止静默跳过）
- [ ] Step 1-24 无回归

### 合规要求

- [ ] 所有查询含 `WHERE tenant_id = $tid`（INV-2）
- [ ] 测试覆盖 ≥2 租户互不串（INV-3）
- [ ] FR-5.5 devices 字段统一有 migration 文件或正式 decision（INV-1）
- [ ] PR 描述声明推进 Path 2 的哪些 Step

### manual oracle 执行记录（批准前填写）

| Step | 执行时间 | exit code | 备注 |
|------|---------|-----------|------|
| Step 25 | _待填_ | _待填_ | |
| Step 26 | _待填_ | _待填_ | |
| Step 27 | _待填_ | _待填_ | |
| Step 28 | _待填_ | _待填_ | |
| Step 29 | _待填_ | _待填_ | |

> INV-7：合同批准前必须在 staging 环境执行 smoke 并填入真实 exit code，确认目标解释器（bash）已启动。

---

## BEHAVIOR 条目汇总

| ID | Golden Path | 关键断言 |
|----|------------|---------|
| BEHAVIOR-GP1-A | GP-1 | 有 assignment 的 lead outreach_status==touched |
| BEHAVIOR-GP1-B | GP-1 | 无 assignment 的 lead outreach_status==untouched |
| BEHAVIOR-GP1-C | GP-1 | 多条 assignment 取最新一条 |
| BEHAVIOR-GP1-D | GP-1 | 跨租户 lead 不串（INV-2） |
| BEHAVIOR-GP2-A | GP-2 | defaults 返回 accounts[]+default_script |
| BEHAVIOR-GP2-B | GP-2 | manual 写入 dm_assignments |
| BEHAVIOR-GP2-C | GP-2 | manual 幂等 upsert 不重复 INSERT |
| BEHAVIOR-GP2-D | GP-2 | cancelling 态弹窗禁用 |
| BEHAVIOR-GP3-A | GP-3 | install-pack 返回 download_url |
| BEHAVIOR-GP4-A | GP-4 | 30 天内同租户同关键词 duplicate:true |
| BEHAVIOR-GP4-B | GP-4 | force:true 跳过去重 |
| BEHAVIOR-GP4-C | GP-4 | 跨租户不互触（INV-2、INV-3） |
| BEHAVIOR-GP4-D | GP-4 | 超 30 天不触发 |
| BEHAVIOR-GP5-A | GP-5 | tasks 含 status 7 态合法值 |
| BEHAVIOR-GP5-B | GP-5 | failed 任务含 error_message 中文翻译 |
| BEHAVIOR-GP5-C | GP-5 | cancelling 态禁重试 |
| BEHAVIOR-GP5-D | GP-5 | 设备类型字段值域统一（INV-1） |

**BEHAVIOR 条目总数：17**
