---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Acquisition 合并配置校验

**范围**: 合并当前租户配置后校验 keyword 上下界、拒绝非法有效配置且零持久化、保留合法更新与租户隔离。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 Postgres 集成测试覆盖对称冲突、合法回归与双租户隔离
  Test: node -e "const c=require('fs').readFileSync('sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-effective-config.integration.test.ts','utf8'); for (const s of ['部分更新 min 与当前 max 合并后冲突','部分更新 max 与当前 min 合并后冲突','合法部分更新、合法完整更新和等值边界','tenantB']) if (!c.includes(s)) process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 仅更新 min 使合并有效配置冲突时明确拒绝 [接缝×2]
  动作: 给已存 min=3/max=5 的当前租户 PUT 仅含 `keywords_per_round_min=10` 的补丁
  预期观察: 同步收到 HTTP 400，响应 `error.code` 为 `INVALID_CONFIG`
  等待预算: 0s
  留证: `/tmp/acq-b01.json` 与 HTTP 状态码输出
  Test: manual:bash -c ': "${DB_URL:?}"; T=$(node -e '\''console.log(require("crypto").randomUUID())'\''); trap '\''psql "$DB_URL" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" >/dev/null'\'' EXIT; psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('"'"'$T'"'"',3,5)" >/dev/null; C=$(curl -sS -o /tmp/acq-b01.json -w "%{http_code}" -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H "Content-Type: application/json" -H "X-Tenant-Id: $T" -d '\''{"keywords_per_round_min":10}'\''); [ "$C" = 400 ] && jq -e '\''.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type)=="string"'\'' /tmp/acq-b01.json'

- [ ] [BEHAVIOR] [L2] B-02: 仅更新 max 使合并有效配置冲突时明确拒绝 [接缝×2]
  动作: 给已存 min=7/max=9 的当前租户 PUT 仅含 `keywords_per_round_max=5` 的补丁
  预期观察: 同步收到 HTTP 400，响应顶层 keys 完整且 `error.code` 为 `INVALID_CONFIG`
  等待预算: 0s
  留证: `/tmp/acq-b02.json` 与 HTTP 状态码输出
  Test: manual:bash -c ': "${DB_URL:?}"; T=$(node -e '\''console.log(require("crypto").randomUUID())'\''); trap '\''psql "$DB_URL" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" >/dev/null'\'' EXIT; psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('"'"'$T'"'"',7,9)" >/dev/null; C=$(curl -sS -o /tmp/acq-b02.json -w "%{http_code}" -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H "Content-Type: application/json" -H "X-Tenant-Id: $T" -d '\''{"keywords_per_round_max":5}'\''); [ "$C" = 400 ] && jq -e '\''keys==["error","success","timestamp"] and .error.code=="INVALID_CONFIG"'\'' /tmp/acq-b02.json'

- [ ] [BEHAVIOR] [L2] B-03: 非法有效配置零持久化且第二租户不受影响 [接缝×2]
  动作: 记录两个租户边界，向租户 A 提交冲突补丁后重新读取两行
  预期观察: 租户 A 与租户 B 的上下界均与请求前完全一致
  等待预算: 0s
  留证: psql 写前/写后 JSON 与 `/tmp/acq-b03.json`
  Test: manual:bash -c ': "${DB_URL:?}"; A=$(node -e '\''console.log(require("crypto").randomUUID())'\''); B=$(node -e '\''console.log(require("crypto").randomUUID())'\''); trap '\''psql "$DB_URL" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id IN ('"'"'$A'"'"','"'"'$B'"'"')" >/dev/null'\'' EXIT; psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('"'"'$A'"'"',3,5),('"'"'$B'"'"',7,9)" >/dev/null; BEFORE=$(psql "$DB_URL" -Atc "SELECT string_agg(tenant_id::text||'"'"':'"'"'||keywords_per_round_min||'"'"':'"'"'||keywords_per_round_max,'"'"','"'"' ORDER BY tenant_id) FROM zenithjoy.acquisition_config WHERE tenant_id IN ('"'"'$A'"'"','"'"'$B'"'"')"); C=$(curl -sS -o /tmp/acq-b03.json -w "%{http_code}" -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H "Content-Type: application/json" -H "X-Tenant-Id: $A" -d '\''{"keywords_per_round_min":10}'\''); AFTER=$(psql "$DB_URL" -Atc "SELECT string_agg(tenant_id::text||'"'"':'"'"'||keywords_per_round_min||'"'"':'"'"'||keywords_per_round_max,'"'"','"'"' ORDER BY tenant_id) FROM zenithjoy.acquisition_config WHERE tenant_id IN ('"'"'$A'"'"','"'"'$B'"'"')"); [ "$C" = 400 ] && [ "$AFTER" = "$BEFORE" ]'

- [ ] [BEHAVIOR] [L2] B-04: 合法部分更新保持成功并可读取
  动作: 给已存 min=3/max=5 的当前租户仅更新 max=8
  预期观察: HTTP 200 响应与真 Postgres 均显示 min=3/max=8
  等待预算: 0s
  留证: curl JSON 与 psql 定点查询输出
  Test: manual:bash -c ': "${DB_URL:?}"; T=$(node -e '\''console.log(require("crypto").randomUUID())'\''); trap '\''psql "$DB_URL" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" >/dev/null'\'' EXIT; psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('"'"'$T'"'"',3,5)" >/dev/null; R=$(curl -sf -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H "Content-Type: application/json" -H "X-Tenant-Id: $T" -d '\''{"keywords_per_round_max":8}'\''); echo "$R" | jq -e --arg t "$T" '\''.success==true and .data.tenant_id==$t and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==8'\''; psql "$DB_URL" -tAc "SELECT keywords_per_round_min=3 AND keywords_per_round_max=8 FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" | grep -qx t'

- [ ] [BEHAVIOR] [L2] B-05: 合法完整更新与 min=max 边界保持成功
  动作: 给当前租户同时提交 min=6/max=6
  预期观察: HTTP 200 且响应 keys/字段值与持久化值均正确
  等待预算: 0s
  留证: curl JSON 与 psql 定点查询输出
  Test: manual:bash -c ': "${DB_URL:?}"; T=$(node -e '\''console.log(require("crypto").randomUUID())'\''); trap '\''psql "$DB_URL" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" >/dev/null'\'' EXIT; R=$(curl -sf -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H "Content-Type: application/json" -H "X-Tenant-Id: $T" -d '\''{"keywords_per_round_min":6,"keywords_per_round_max":6}'\''); echo "$R" | jq -e '\''.success==true and (.data|has("keywords_per_round_min")) and (.data|has("keywords_per_round_max")) and .data.keywords_per_round_min==6 and .data.keywords_per_round_max==6'\''; psql "$DB_URL" -tAc "SELECT keywords_per_round_min=6 AND keywords_per_round_max=6 FROM zenithjoy.acquisition_config WHERE tenant_id='"'"'$T'"'"'" | grep -qx t'

## Invariant 覆盖

- INV-1 [TDD提交]: 共享 Red fixture 不改；本 Sprint 只新增合同目录测试，Red evidence 单独记录。
- INV-2 [真实判定]: B-01/B-02 同时断言 HTTP 状态与 `error.code`，不只看通用 `success`。
- INV-3 [真实执行]: evaluator 记录每条 manual oracle 的 exit_code；目标解释器由实际 `bash`/`psql`/`curl` 启动证明。
- INV-4 [失败分支]: N/A，本变更边界不引入返回 null/false 的新调用。
- INV-5 [单槽串行]: task-plan 仅 ws1，无并行实现者。
- INV-6 [环境假设]: API_BASE/DB_URL 从环境读取，租户 UUID 动态生成。
- INV-7 [真实环境]: B-01 至 B-05 在 local_api + 真 Postgres 执行，未执行前标 logic-done-pending。
- INV-8 [多租户测试]: B-03 与 integration test 使用至少两个租户并断言互不串扰。
- INV-9 [凭据安全]: 合同不硬编码 secret，DB_URL 只从环境注入且不打印。
- INV-10 [日志脱敏]: 测试仅使用随机 UUID 和数值配置，不输出 PII/聊天内容。
- INV-11 [端点鉴权]: 请求通过现有 `tenantContextOptional` 的 `X-Tenant-Id` 认证/租户上下文路径。
- INV-12 [租户隔离]: B-03 真实查询两租户并断言另一个租户不变。
