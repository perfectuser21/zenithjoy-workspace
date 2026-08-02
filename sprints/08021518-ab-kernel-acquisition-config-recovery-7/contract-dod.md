---
skeleton: false
journey_type: autonomous
---
# Contract DoD — acquisition 配置合并校验恢复

**范围**: 合并后关键词上下界校验、400/INVALID_CONFIG、零持久化、有效更新与租户隔离回归。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 Postgres integration 测试存在且不得 mock 配置服务、路由或 DB
  Test: node -e "const fs=require('fs');const p='sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts';const c=fs.readFileSync(p,'utf8');if(!c.includes('new Pool')||/vi\.mock|jest\.mock|stub\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 共享 Red fixture 未被本 sprint 修改
  Test: bash -c 'git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- shared-red-fixture 2>/dev/null || { [ ! -e shared-red-fixture ] && exit 0; exit 1; }'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 只更新最小值且合并后倒置时返回稳定错误 [接缝×2]
  动作: A 租户当前 min=3/max=8，连续两次 PUT 只提交 min=9
  预期观察: 两次均在 30s 内返回 HTTP 400，error.code 字面为 INVALID_CONFIG
  等待预算: 30s
  留证: 两次 HTTP 状态码与响应 JSON 输出
  Test: manual:bash -c 'for N in 1 2; do F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":9}"); [ "$C" = 400 ] && jq -e ".success==false and .error.code==\"INVALID_CONFIG\"" "$F" || exit 1; done'

- [ ] [BEHAVIOR] [L2] B-02: 错误响应 schema 完整且禁用字段不存在
  动作: A 租户提交合并后上下界倒置的部分更新并捕获响应体
  预期观察: 顶层仅含 error、success、timestamp，error.message 为字符串且无 error_code
  等待预算: 30s
  留证: jq schema 断言输出
  Test: manual:bash -c 'F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":9}"); [ "$C" = 400 ] && jq -e ".error.message|type==\"string\"" "$F" && jq -e "keys==[\"error\",\"success\",\"timestamp\"] and (has(\"error_code\")|not) and (has(\"code\")|not)" "$F"'

- [ ] [BEHAVIOR] [L2] B-03: 无效部分更新零持久化且另一租户不变 [接缝×2]
  动作: 记录 A/B 两租户整行快照，A 提交合并后无效 patch，再读取两行
  预期观察: A 与 B 的请求后整行 JSON 分别等于各自请求前快照
  等待预算: 30s
  留证: A/B 请求前后 row_to_json 查询结果
  Test: manual:bash -c 'A0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_A_ID'"'"'"); B0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_B_ID'"'"'"); curl -sS -o /tmp/acq-invalid.json -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":9}"; A1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_A_ID'"'"'"); B1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_B_ID'"'"'"); [ "$A0" = "$A1" ] && [ "$B0" = "$B1" ]'

- [ ] [BEHAVIOR] [L2] B-04: 只更新最大值导致合并后倒置同样拒绝
  动作: A 租户当前 min=3/max=8，先有效设 min=7，再只提交 max=6
  预期观察: 第二次请求返回 HTTP 400/INVALID_CONFIG，配置仍为 min=7/max=8
  等待预算: 30s
  留证: HTTP 响应与 DB 定点查询输出
  Test: manual:bash -c 'curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":7}" | jq -e ".success==true"; F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_max\":6}"); [ "$C" = 400 ] && jq -e ".error.code==\"INVALID_CONFIG\"" "$F" && psql "$DB_URL" -XtAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=8 FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$TENANT_A_ID'"'"'" | grep -qx t'

- [ ] [BEHAVIOR] [L2] B-05: 相等边界与完整有效更新成功
  动作: A 租户完整提交 min=7/max=7，随后 GET 配置
  预期观察: PUT 与 GET 均成功且两个字段均为 7
  等待预算: 30s
  留证: PUT/GET JSON 与 DB 查询输出
  Test: manual:bash -c 'curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"keywords_per_round_min\":7,\"keywords_per_round_max\":7}" | jq -e ".success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7"; curl -sf "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" | jq -e ".data.keywords_per_round_min==7 and .data.keywords_per_round_max==7"; psql "$DB_URL" -XtAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=7 FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$TENANT_A_ID'"'"'" | grep -qx t'

- [ ] [BEHAVIOR] [L2] B-06: body tenant_id 不能越权改另一租户
  动作: A 的鉴权请求在 body 注入 B 的 tenant_id 并提交有效值
  预期观察: 只有 A 租户更新，B 租户整行保持不变
  等待预算: 30s
  留证: A/B tenant_id 与 row_to_json 查询输出
  Test: manual:bash -c 'B0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_B_ID'"'"'"); curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_B_ID\",\"keywords_per_round_min\":6,\"keywords_per_round_max\":8}" | jq -e ".success==true and .data.tenant_id==\"$TENANT_A_ID\""; B1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='"'"'$TENANT_B_ID'"'"'"); [ "$B0" = "$B1" ]'

## Invariant 映射

- INV-1 租户隔离：B-03、B-06 真 Postgres 两租户断言。
- INV-2 测试多租户：B-03、B-06 与 integration test 均使用 A/B 两租户。
- INV-3 端点鉴权：B-01 至 B-06 使用现有 `X-Feishu-User-Id`，缺失鉴权行为不在本次改动范围，N/A。
- INV-4 凭据安全：所有连接串/用户标识由环境变量注入，仓库无 secret。
- INV-5 日志脱敏：错误只断言稳定 code 与非空 message，不要求记录完整配置。
- INV-6 真环境验证：B-01/B-03 标接缝并在 local_api + 真 Postgres 重复两次。
- INV-7 环境假设：API_URL、DB_URL、租户用户均由环境注入。
- INV-8 单写手：本 task-plan 只有 ws1 一个实现者。

