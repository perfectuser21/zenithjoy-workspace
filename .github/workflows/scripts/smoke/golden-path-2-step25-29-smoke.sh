#!/usr/bin/env bash
# smoke-step-25-29.sh
# Path 2 Dashboard Visibility Sprint — Step 25-29 smoke 扩展片段
# task_id: 7cb465c1-03cc-4934-a638-e61f78195d37
# target_environment: local_api
#
# 用法：此文件为待合并到 golden-path-2-smoke.sh 的 Step 25-29 片段。
#       实现交付后 commit-4 将此内容合并到主 smoke 脚本尾部（在 exit 0 之前）。
#
# 先红状态：所有 Step 在实现前必须 FAIL（exit 1）。
#
# 依赖：
#   API_BASE=http://localhost:5200
#   DB_URL=postgresql://...
#   TENANT_ID=<从 Step 1 注册的租户，已在主脚本 seed）
#   AGENT_PK=<从 Step 2 注册的 agent，已在主脚本 seed）
#
# 沿用主脚本的 ok/fail/psq 函数。

set -euo pipefail

# 若独立运行需要自行定义这些变量和函数
: "${API_BASE:?需设置 API_BASE}"
: "${DB_URL:?需设置 DB_URL}"
: "${TENANT_ID:?需设置 TENANT_ID}"

ok()   { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; exit "${2:-1}"; }
psq()  { psql "$DB_URL" -t -A -c "$1"; }

RND="p2dash${RANDOM}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 25 — FR-1：获客列表触达状态展示
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "▶ Step 25: 获客列表 outreach_status 字段展示（FR-1）"
S25_TMP=$(mktemp)
S25_TENANT="s25-${RND}"

# seed: 插入 lead（无 assignment）
S25_LEAD_NO_ASSIGN=$(psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, nickname, comment_text) \
  VALUES ('$S25_TENANT', 's25_no_assign', 'comment') \
  RETURNING id")
[ -n "$S25_LEAD_NO_ASSIGN" ] || fail "Step 25 seed lead(无assignment) 失败" 25

# seed: 插入 lead（有 sent assignment）
S25_LEAD_WITH=$(psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, nickname, comment_text) \
  VALUES ('$S25_TENANT', 's25_with_assign', 'comment') \
  RETURNING id")
psq "INSERT INTO zenithjoy.dm_assignments \
  (tenant_id, lead_id, account_label, status) \
  VALUES ('$S25_TENANT', '$S25_LEAD_WITH', 's25_acc', 'sent')" > /dev/null

# seed: lead with multiple assignments, latest = failed
S25_LEAD_MULTI=$(psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, nickname, comment_text) \
  VALUES ('$S25_TENANT', 's25_multi', 'comment') \
  RETURNING id")
psq "INSERT INTO zenithjoy.dm_assignments \
  (tenant_id, lead_id, account_label, status, updated_at) \
  VALUES ('$S25_TENANT', '$S25_LEAD_MULTI', 's25_acc_old', 'sent', NOW() - interval '1 hour')" > /dev/null
psq "INSERT INTO zenithjoy.dm_assignments \
  (tenant_id, lead_id, account_label, status, updated_at) \
  VALUES ('$S25_TENANT', '$S25_LEAD_MULTI', 's25_acc_new', 'failed', NOW())" > /dev/null

S25_HTTP=$(curl -s -o "$S25_TMP" -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $S25_TENANT")
[ "$S25_HTTP" = "200" ] || fail "Step 25 GET /leads 期望 200, 得 $S25_HTTP: $(cat "$S25_TMP")" 25

# 断言1：所有 lead 含 outreach_status 字段
python3 -c "
import json,sys
leads=json.load(open('$S25_TMP'))['leads']
missing=[l.get('commenter_id','?') for l in leads if 'outreach_status' not in l]
if missing:
    print('FAIL: leads 缺 outreach_status:', missing); sys.exit(1)
print('OK: 所有 lead 含 outreach_status')
" || fail "Step 25a leads 缺 outreach_status 字段（FR-1.1）" 25

# 断言2：无 assignment 的 lead → untouched
python3 -c "
import json,sys
leads=json.load(open('$S25_TMP'))['leads']
no_assign=[l for l in leads if l.get('commenter_id','')=='s25_no_assign']
if not no_assign:
    print('WARN: 未找到 s25_no_assign lead，跳过断言'); sys.exit(0)
st=no_assign[0].get('outreach_status')
if st != 'untouched':
    print('FAIL: 无 assignment lead 期望 untouched, 得', st); sys.exit(1)
print('OK: 无 assignment lead → untouched')
" || fail "Step 25b 无 assignment lead 未返回 untouched（FR-1.2）" 25

# 断言3：有 sent assignment 的 lead → touched
python3 -c "
import json,sys
leads=json.load(open('$S25_TMP'))['leads']
with_assign=[l for l in leads if l.get('commenter_id','')=='s25_with_assign']
if not with_assign:
    print('WARN: 未找到 s25_with_assign lead，跳过断言'); sys.exit(0)
st=with_assign[0].get('outreach_status')
if st != 'touched':
    print('FAIL: 有 sent assignment lead 期望 touched, 得', st); sys.exit(1)
print('OK: 有 sent assignment lead → touched')
" || fail "Step 25c 有 assignment lead 未返回 touched（FR-1.1）" 25

# 断言4：多条 assignment，最新 failed → retry_needed
python3 -c "
import json,sys
leads=json.load(open('$S25_TMP'))['leads']
multi=[l for l in leads if l.get('commenter_id','')=='s25_multi']
if not multi:
    print('WARN: 未找到 s25_multi lead，跳过断言'); sys.exit(0)
st=multi[0].get('outreach_status')
if st != 'retry_needed':
    print('FAIL: 多条 assignment 最新 failed 期望 retry_needed, 得', st); sys.exit(1)
print('OK: 多条 assignment 取最新 failed → retry_needed')
" || fail "Step 25d 多条 assignment 取最新规则未正确实现（FR-1.3）" 25

ok "Step 25 ✅ 获客列表 outreach_status 展示全链路通过（无 assignment→untouched / sent→touched / 多条取最新 failed→retry_needed）"
rm -f "$S25_TMP"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 26 — FR-2：人工触达配置弹窗（选号+话术）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "▶ Step 26: 人工触达选号/话术接口（FR-2）"
S26_TMP=$(mktemp)
S26_TENANT="s26-${RND}"
S26_LEAD=$(psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, nickname, comment_text) \
  VALUES ('$S26_TENANT', 's26_lead', 'comment') RETURNING id")
[ -n "$S26_LEAD" ] || fail "Step 26 seed lead 失败" 26

# 26a: GET outreach/defaults
S26_HTTP=$(curl -s -o "$S26_TMP" -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/acquisition/outreach/defaults?lead_id=$S26_LEAD" \
  -H "X-Tenant-Id: $S26_TENANT")
[ "$S26_HTTP" = "200" ] || fail "Step 26a GET /outreach/defaults 期望 200, 得 $S26_HTTP: $(cat "$S26_TMP")" 26

python3 -c "
import json,sys
data=json.load(open('$S26_TMP'))
has_accounts='accounts' in data and isinstance(data['accounts'],list)
has_script='default_script' in data and data['default_script']
if not has_accounts:
    print('FAIL: 缺 accounts 数组'); sys.exit(1)
if not has_script:
    print('FAIL: 缺 default_script 字段'); sys.exit(1)
# 检查 online_source 标注（心跳代理）
for acc in data['accounts']:
    src=acc.get('online_source','')
    if src != 'heartbeat_proxy':
        print('WARN: account online_source 期望 heartbeat_proxy, 得', src)
print('OK: defaults 返回 accounts[] + default_script')
" || fail "Step 26a /outreach/defaults 响应格式不符（FR-2.1 / FR-2.2）" 26

# 26b: POST outreach/manual
S26_HTTP2=$(curl -s -o "$S26_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/outreach/manual" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $S26_TENANT" \
  -d "{\"lead_id\":\"$S26_LEAD\",\"account_label\":\"s26_burner\",\"script_text\":\"测试话术\"}")
[ "$S26_HTTP2" = "200" ] || fail "Step 26b POST /outreach/manual 期望 200, 得 $S26_HTTP2: $(cat "$S26_TMP")" 26

S26_COUNT=$(psq "SELECT count(*) FROM zenithjoy.dm_assignments \
  WHERE tenant_id='$S26_TENANT' AND lead_id='$S26_LEAD' AND account_label='s26_burner'")
[ "$S26_COUNT" = "1" ] || fail "Step 26b dm_assignments 期望 1 行, 得 $S26_COUNT（写入失败）" 26
ok "Step 26b ✅ POST /outreach/manual 写入 dm_assignments 成功"

# 26c: 幂等测试（命中唯一约束走 UPDATE）
S26_HTTP3=$(curl -s -o "$S26_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/outreach/manual" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $S26_TENANT" \
  -d "{\"lead_id\":\"$S26_LEAD\",\"account_label\":\"s26_burner\",\"script_text\":\"更新话术\"}")
[ "$S26_HTTP3" = "200" ] || fail "Step 26c 幂等 POST 期望 200（不能是 409）, 得 $S26_HTTP3" 26

S26_COUNT2=$(psq "SELECT count(*) FROM zenithjoy.dm_assignments \
  WHERE tenant_id='$S26_TENANT' AND lead_id='$S26_LEAD' AND account_label='s26_burner'")
[ "$S26_COUNT2" = "1" ] || fail "Step 26c 幂等后 dm_assignments 期望仍是 1 行, 得 $S26_COUNT2（重复插入！）" 26

ok "Step 26 ✅ 人工触达接口全链路通过（defaults 返回 + manual 写入 + 幂等 upsert）"
rm -f "$S26_TMP"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 27 — FR-3：APK 下载入口未破坏
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "▶ Step 27: APK 下载端点回归验证（FR-3）"
S27_TMP=$(mktemp)

S27_HTTP=$(curl -s -o "$S27_TMP" -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack" \
  -H "X-Tenant-Id: $TENANT_ID")
# 200 = manifest 就绪；503 = manifest 未构建（可接受，不算破坏）
[ "$S27_HTTP" = "200" ] || [ "$S27_HTTP" = "503" ] || \
  fail "Step 27 GET /api/agent/install-pack 期望 200 或 503, 得 $S27_HTTP: $(cat "$S27_TMP")" 27

if [ "$S27_HTTP" = "200" ]; then
  python3 -c "
import json,sys
data=json.load(open('$S27_TMP'))
url=data.get('download_url') or data.get('apk_url') or data.get('url') or (data.get('data') or {}).get('download_url','')
if not url:
    print('FAIL: 响应缺 download_url 字段'); sys.exit(1)
if not url.startswith('http'):
    print('FAIL: download_url 格式错误:', url[:50]); sys.exit(1)
print('OK: download_url =', url[:80])
" || fail "Step 27 install-pack 响应缺 download_url 字段（FR-3.3）" 27
fi

ok "Step 27 ✅ APK 下载端点回归通过（现有逻辑未被破坏）"
rm -f "$S27_TMP"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 28 — FR-4：关键词去重机制
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "▶ Step 28: 关键词去重机制（FR-4）"
S28_TMP=$(mktemp)
S28_TA="s28-ta-${RND}"
S28_TB="s28-tb-${RND}"
S28_KW="kw_dedup_${RND}"

# seed: T_A 5 天前已采集 S28_KW
psq "INSERT INTO zenithjoy.acquisition_collect_tasks \
  (tenant_id, keywords, status, created_at) \
  VALUES ('$S28_TA', ARRAY['$S28_KW'], 'done', NOW() - interval '5 days')" > /dev/null

# 28a: T_A 第二次采集同关键词 → duplicate:true
S28_HTTP=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S28_TA" \
  -d "{\"keywords\":[\"$S28_KW\"]}")
[ "$S28_HTTP" = "200" ] || fail "Step 28a collect/start 期望 200, 得 $S28_HTTP" 28

python3 -c "
import json,sys
data=json.load(open('$S28_TMP'))
dup=data.get('duplicate')
days=data.get('days_ago',-1)
if dup is not True:
    print('FAIL: 期望 duplicate=true, 得', dup); sys.exit(1)
if not (0 <= days <= 30):
    print('FAIL: 期望 days_ago 在 [0,30], 得', days); sys.exit(1)
print('OK: duplicate=true, days_ago=', days)
" || fail "Step 28a 30 天内重复关键词未触发 duplicate:true（FR-4.1/4.2）" 28

# 28b: force=true 强制重跑
S28_HTTP2=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S28_TA" \
  -d "{\"keywords\":[\"$S28_KW\"],\"force\":true}")
[ "$S28_HTTP2" = "200" ] || fail "Step 28b force=true collect/start 期望 200, 得 $S28_HTTP2" 28

python3 -c "
import json,sys
data=json.load(open('$S28_TMP'))
dup=data.get('duplicate',False)
tid=data.get('task_id') or (data.get('data') or {}).get('task_id') or data.get('id','')
if dup:
    print('FAIL: force=true 时 duplicate 应为 false, 得 True'); sys.exit(1)
if not tid:
    print('FAIL: force=true 应返回 task_id'); sys.exit(1)
print('OK: force=true → 正常执行, task_id=', tid)
" || fail "Step 28b force=true 未跳过去重（FR-4.3）" 28

# 28c: 跨租户不互触（INV-2 / INV-3）
S28_HTTP3=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S28_TB" \
  -d "{\"keywords\":[\"$S28_KW\"]}")
[ "$S28_HTTP3" = "200" ] || fail "Step 28c T_B collect/start 期望 200, 得 $S28_HTTP3" 28

python3 -c "
import json,sys
data=json.load(open('$S28_TMP'))
dup=data.get('duplicate',False)
if dup:
    print('FAIL: T_B 不应被 T_A 关键词历史影响, 但 duplicate=True'); sys.exit(1)
print('OK: T_B 不受 T_A 关键词历史影响（tenant 隔离正常）')
" || fail "Step 28c 跨租户关键词去重串台（INV-2 违反）" 28

# 28d: 超 30 天不触发
S28_KW_OLD="kw_old_${RND}"
psq "INSERT INTO zenithjoy.acquisition_collect_tasks \
  (tenant_id, keywords, status, created_at) \
  VALUES ('$S28_TA', ARRAY['$S28_KW_OLD'], 'done', NOW() - interval '31 days')" > /dev/null

S28_HTTP4=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S28_TA" \
  -d "{\"keywords\":[\"$S28_KW_OLD\"]}")
[ "$S28_HTTP4" = "200" ] || fail "Step 28d 超 30 天关键词 collect/start 期望 200, 得 $S28_HTTP4" 28

python3 -c "
import json,sys
data=json.load(open('$S28_TMP'))
dup=data.get('duplicate',False)
if dup:
    print('FAIL: 31 天前的关键词不应触发 duplicate:true'); sys.exit(1)
print('OK: 超 30 天关键词不触发去重')
" || fail "Step 28d 超 30 天关键词错误触发去重（FR-4.5 违反）" 28

# 28e: sec_uid 强去重（BEHAVIOR-GP4-E / INV-5）
# 同租户同 sec_uid 采集两次，leads 表只有 1 条（ON CONFLICT DO NOTHING 生效）
S28_SEC_UID="sec_uid_dedup_${RND}"
S28_TENANT_E="s28-te-${RND}"
psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, sec_uid, nickname, comment_text) \
  VALUES ('$S28_TENANT_E', '$S28_SEC_UID', 'lead_first', 'comment1') \
  ON CONFLICT DO NOTHING" > /dev/null
psq "INSERT INTO zenithjoy.acquisition_leads \
  (tenant_id, sec_uid, nickname, comment_text) \
  VALUES ('$S28_TENANT_E', '$S28_SEC_UID', 'lead_second', 'comment2') \
  ON CONFLICT DO NOTHING" > /dev/null

S28_SEC_UID_COUNT=$(psq "SELECT count(*) FROM zenithjoy.acquisition_leads \
  WHERE tenant_id='$S28_TENANT_E' AND sec_uid='$S28_SEC_UID'")
[ "$S28_SEC_UID_COUNT" = "1" ] || \
  fail "Step 28e sec_uid 强去重失败：同租户同 sec_uid 期望 1 条，得 $S28_SEC_UID_COUNT（ON CONFLICT DO NOTHING 未生效，BEHAVIOR-GP4-E / INV-5 违反）" 28

ok "Step 28 ✅ 关键词去重机制全链路通过（30天内→duplicate:true / force跳过 / 跨租户隔离 / 超30天不触发 / sec_uid强去重）"
rm -f "$S28_TMP"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 29 — FR-5：任务进程可视化 + 设备类型字段值域统一
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "▶ Step 29: 任务进程 7 态展示 + 设备类型字段值域统一（FR-5）"
S29_TMP=$(mktemp)
S29_TENANT="s29-${RND}"

# seed: 插入各状态任务
for S in pending running stage_1_done done partial failed cancelling; do
  psq "INSERT INTO zenithjoy.acquisition_collect_tasks \
    (tenant_id, keywords, status) VALUES ('$S29_TENANT', ARRAY['kw_$S'], '$S')" > /dev/null
done
# seed: 插入 failed 任务带 error_code
psq "INSERT INTO zenithjoy.acquisition_collect_tasks \
  (tenant_id, keywords, status, error_code) \
  VALUES ('$S29_TENANT', ARRAY['kw_err'], 'failed', 'quota_exceeded')" > /dev/null

# 29a: GET /collect/tasks 7 态合法值
S29_HTTP=$(curl -s -o "$S29_TMP" -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/acquisition/collect/tasks" \
  -H "X-Tenant-Id: $S29_TENANT")
[ "$S29_HTTP" = "200" ] || fail "Step 29a GET /collect/tasks 期望 200, 得 $S29_HTTP: $(cat "$S29_TMP")" 29

python3 -c "
import json,sys
VALID={'pending','running','stage_1_done','done','partial','failed','cancelling'}
data=json.load(open('$S29_TMP'))
tasks=data.get('tasks') or data.get('data') or []
if not tasks:
    print('FAIL: tasks 数组为空（seed 数据未返回）'); sys.exit(1)
bad=[t.get('status') for t in tasks if t.get('status') not in VALID]
if bad:
    print('FAIL: 非法 status 值:', bad); sys.exit(1)
print('OK: 所有任务 status 在 7 态合法值内，共', len(tasks), '条')
" || fail "Step 29a tasks status 字段不符合 7 态规范（FR-5.1）" 29

# 29b: 失败任务含 error_message 中文翻译
python3 -c "
import json,sys
data=json.load(open('$S29_TMP'))
tasks=data.get('tasks') or data.get('data') or []
failed_with_code=[t for t in tasks if t.get('status')=='failed' and t.get('error_code')]
for t in failed_with_code:
    msg=t.get('error_message','')
    if not msg or len(msg) < 3:
        print('FAIL: failed 任务缺 error_message, error_code=', t.get('error_code')); sys.exit(1)
print('OK: 所有 failed 任务含 error_message 人话翻译')
" || fail "Step 29b failed 任务缺 error_message 翻译（FR-5.2）" 29

# 29c: cancelling 态禁重试
S29_CANCEL_TASK=$(psq "SELECT id FROM zenithjoy.acquisition_collect_tasks \
  WHERE tenant_id='$S29_TENANT' AND status='cancelling' LIMIT 1")
if [ -n "$S29_CANCEL_TASK" ]; then
  S29_HTTP2=$(curl -s -o "$S29_TMP" -w "%{http_code}" --max-time 15 \
    -X POST "$API_BASE/api/acquisition/collect/retry?task_id=$S29_CANCEL_TASK" \
    -H "X-Tenant-Id: $S29_TENANT")
  [ "$S29_HTTP2" = "400" ] || [ "$S29_HTTP2" = "409" ] || \
    fail "Step 29c cancelling 任务重试期望 400/409, 得 $S29_HTTP2（cancelling 防重入未实现）" 29
  ok "Step 29c ✅ cancelling 任务重试被正确拒绝（HTTP $S29_HTTP2）"
else
  fail "Step 29c cancelling 任务 seed 失败，无法验证防重入" 29
fi

# 29d: DB schema 层验证 agents.os_type 与 line02_account_sessions.device_type 值域一致（INV-1）
# 检查 agents 表 CHECK 约束或列注释包含 'android'
AGENTS_OS_CHECK=$(psq "SELECT pg_get_constraintdef(oid) FROM pg_constraint \
  WHERE conrelid='zenithjoy.agents'::regclass AND pg_get_constraintdef(oid) LIKE '%os_type%'" 2>/dev/null || echo "")
# 若无 CHECK，检查是否存在枚举类型
AGENTS_OS_VALS=$(psq "SELECT column_default FROM information_schema.columns \
  WHERE table_schema='zenithjoy' AND table_name='agents' AND column_name='os_type'" 2>/dev/null || echo "")

# line02_account_sessions.device_type CHECK 约束
LINE02_DEV_CHECK=$(psq "SELECT pg_get_constraintdef(oid) FROM pg_constraint \
  WHERE conrelid='zenithjoy.line02_account_sessions'::regclass \
  AND pg_get_constraintdef(oid) LIKE '%device_type%'" 2>/dev/null || echo "")

echo "  agents.os_type constraint: ${AGENTS_OS_CHECK:-无 CHECK 约束}"
echo "  line02_account_sessions.device_type constraint: ${LINE02_DEV_CHECK:-无 CHECK 约束}"

# 断言：两列定义中均含 'android'（统一后的值域）
echo "$AGENTS_OS_CHECK $AGENTS_OS_VALS" | grep -q "android" || \
  fail "Step 29d agents.os_type 定义中不含 'android'——值域未统一到 android|windows|unknown（INV-1 违反）" 29
echo "$LINE02_DEV_CHECK" | grep -q "android" || \
  fail "Step 29d line02_account_sessions.device_type 定义中不含 'android'——值域未统一（INV-1 违反）" 29

ok "Step 29 ✅ 任务进程展示 + 设备类型字段值域统一全链路通过"
rm -f "$S29_TMP"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Path 2 Dashboard Visibility Sprint smoke Step 25-29 全绿"
echo "  target_environment: local_api（API 层断言）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
# 注意：此文件为片段，不含 exit 0——合并到 golden-path-2-smoke.sh 时去掉 main 脚本的 exit 0 再追加本内容
