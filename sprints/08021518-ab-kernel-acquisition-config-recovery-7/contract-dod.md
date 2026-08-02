---
skeleton: false
journey_type: autonomous
---
# Contract DoD — acquisition 配置合并校验恢复

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 HTTP + 真 Postgres integration 测试存在且不 mock 路由、服务或 DB
  Test: node -e "const c=require('fs').readFileSync('sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts','utf8');if(!c.includes('supertest')||!c.includes('new Pool')||/vi\.mock|jest\.mock|stub\(/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化 [接缝×2]
  动作: A 当前 min=3/max=8，使用 X-Tenant-Id 连续两次 PUT 只提交 min=9
  预期观察: 两次均返回 HTTP 400/INVALID_CONFIG，A/B 配置均不变
  等待预算: 30s
  留证: HTTP 状态、响应 JSON、A/B 前后 DB 快照
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 错误 schema 完整且不误映射为 500
  动作: 捕获合并后无效 patch 的真 HTTP 响应
  预期观察: 状态恰为 400；顶层仅 error/success/timestamp；无禁用字段
  等待预算: 30s
  留证: 状态码与 jq 输出
  Test: manual:bash -c 'F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":9}"); [ "$C" = 400 ] && jq -e ".success==false and .error.code==\"INVALID_CONFIG\" and (.error.message|type==\"string\" and length>0) and (keys==[\"error\",\"success\",\"timestamp\"]) and (has(\"error_code\")|not) and (has(\"code\")|not)" "$F"'

- [ ] [BEHAVIOR] [L2] B-03: max-only 合并倒置同样拒绝且零写入 [接缝×2]
  动作: A 当前 min=3/max=8，连续两次只提交 max=2
  预期观察: 两次均为 400/INVALID_CONFIG，A 的整行快照不变
  等待预算: 30s
  留证: 两次响应与 row_to_json 前后快照
  Test: manual:bash -c 'A0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_A_ID'"'"'"); for N in 1 2; do F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H "Content-Type: application/json" -d "{\"keywords_per_round_max\":2}"); [ "$C" = 400 ] && jq -e ".error.code==\"INVALID_CONFIG\"" "$F" || exit 1; done; A1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_A_ID'"'"'"); [ "$A0" = "$A1" ]'

- [ ] [BEHAVIOR] [L2] B-04: 有效部分、完整和相等边界更新继续成功且不串租户
  动作: A 依次提交有效 min-only、max-only 和 min=max 完整更新
  预期观察: 均成功且 DB 最终为 7/7，B 配置不变
  等待预算: 30s
  留证: Vitest 真 HTTP 与真 DB 输出
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "有效部分、完整和相等边界更新继续成功且不串租户" --reporter=verbose'

## Invariant 映射

- INV-1 租户隔离、INV-2 测试多租户：B-01/B-04 使用 A/B 真租户并断言 B 不变。
- INV-3 端点鉴权：沿用 X-Tenant-Id；鉴权行为不改，N/A。
- INV-4 凭据安全、INV-5 日志脱敏：连接串仅由环境注入，响应不回显配置。
- INV-6 真环境验证：B-01/B-03 在 local_api + 真 Postgres 重复两次。
- INV-7 环境假设：API_URL、DB_URL、tenant id 均由环境或隔离 fixture 提供。
- INV-8 单写手：task-plan 仅 ws1。
