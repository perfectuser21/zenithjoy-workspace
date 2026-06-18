# seed.sh — 共享 seed helper（被 contract-dod.md [BEHAVIOR] manual:bash source）
# 依赖 env：$DB（postgres）。所有插入均 scope 到新建 tenant，保证每条 BEHAVIOR 独立可跑。
# 用法： source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh; seed_acq
#   成功后导出 TENANT_ID / AGENT_ID。可选第 1 参为后缀（默认 $RANDOM），第 2 参 with_doc(默认 1)。

seed_acq() {
  local sfx="${1:-$RANDOM-$RANDOM}"
  local with_doc="${2:-1}"
  TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES ('acq-$sfx','k-acq-$sfx','free') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
  [ -n "$TENANT_ID" ] || { echo "SEED FAIL: 无 tenant_id"; return 1; }
  if [ "$with_doc" = "1" ]; then
    psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings(tenant_id,tenant_access_token,expires_at,app_token,table_id_leads,enterprise_doc_token,bound_at) VALUES ('$TENANT_ID','fake_t',NOW()+interval '1 hour','bascn_acq_$sfx','tbl_acq_leads','doccn_$sfx',NOW())" >/dev/null
  else
    # 已绑飞书但没有企业信息文档（NO_ENTERPRISE_DOC 前置校验用）
    psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings(tenant_id,tenant_access_token,expires_at,app_token,table_id_leads,enterprise_doc_token,bound_at) VALUES ('$TENANT_ID','fake_t',NOW()+interval '1 hour','bascn_acq_$sfx','tbl_acq_leads',NULL,NOW())" >/dev/null
  fi
  AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status) VALUES ('$TENANT_ID','xpc-$sfx','xian-pc','online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
  [ -n "$AGENT_ID" ] || { echo "SEED FAIL: 无 agent_id"; return 1; }
  export TENANT_ID AGENT_ID
}

# 设置 fake-feishu 企业信息文档纯文本内容（CI 用；真飞书 docx 走真实读）。
# 用法：set_enterprise_doc "$TENANT_ID" "行业:家装 受众:30-45 业主 卖点:全屋定制 钩子:免费量房"
set_enterprise_doc() {
  local tid="$1" ; local text="$2"
  local tok
  tok=$(psql "$DB" -At -c "SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$tid'" | tr -d ' ')
  [ -n "$tok" ] || { echo "set_enterprise_doc FAIL: tenant 无 doc_token"; return 1; }
  curl -sf -X POST "${FEISHU_API_BASE}/__test/set-doc" -H "Content-Type: application/json" \
    -d "{\"doc_token\":\"$tok\",\"text\":$(printf '%s' "$text" | jq -Rs .)}" >/dev/null
}

# 直接建一条采集任务（report/status/dedup 类 BEHAVIOR 用，跳过扩词/派单链）。
# 成功导出 COLLECT_TASK_ID。第 2 参 status 默认 running。
seed_collect_task() {
  local tid="$1" ; local st="${2:-running}"
  COLLECT_TASK_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,keywords,source,degraded,status,created_at,updated_at) VALUES ('$tid','[\"家装定制\",\"全屋定制\",\"免费量房\"]'::jsonb,'ai',false,'$st',NOW(),NOW()) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
  [ -n "$COLLECT_TASK_ID" ] || { echo "SEED FAIL: 无 collect_task_id"; return 1; }
  export COLLECT_TASK_ID
}
