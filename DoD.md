contract_branch: cp-harness-propose-r1-565118a4-a0
sprint_dir: sprints/06181529-line04-cs-memory-backend

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Line04 对话记忆三层后端

**范围**: 新建 tenant 隔离的三层对话记忆（短期原文滑窗 / 中期日 summary / 长期融合 summary，per tenant_id × contact）+ summarization（DeepSeek via OpenRouter，失败降级）+ 三个后端能力（写消息 / 取回复上下文 / 触发日收尾）。不接 listen_chat 真机回复路径、不改前端、不改 tenant 模型。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 新建三层记忆 migration（zenithjoy schema，per tenant_id × contact，幂等 IF NOT EXISTS）
  Test: manual:bash -c 'f=$(ls apps/api/db/migrations/*cs_memory*.sql apps/api/db/migrations/*tenant_memory*.sql 2>/dev/null | head -1); [ -n "$f" ] || { echo "FAIL: 缺 migration"; exit 1; }; grep -q "cs_memory_messages" "$f" && grep -q "cs_memory_daily" "$f" && grep -q "cs_memory_longterm" "$f" && grep -q "tenant_id" "$f" || { echo "FAIL: migration 缺三表或 tenant_id"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] 三层记忆服务文件存在且暴露写/取上下文/收尾三能力
  Test: manual:bash -c 'c=$(cat apps/api/src/services/wechat/tenant-memory.ts 2>/dev/null); echo "$c" | grep -q "appendTenantMessage" && echo "$c" | grep -q "getReplyContext" && echo "$c" | grep -q "runDailyConsolidation" || { echo "FAIL: 服务缺三能力之一"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] 三个后端能力 route 已挂载到 app（/api/wechat/memory/*）
  Test: manual:bash -c 'grep -rq "wechat/memory/message\|/memory/message" apps/api/src/routes/ && grep -rq "/memory/consolidate" apps/api/src/routes/ && grep -rq "/memory/context" apps/api/src/routes/ || { echo "FAIL: 缺 route 定义"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（autonomous — 真 Postgres zenithjoy_test，仅 mock OpenRouter；命令从 repo 根运行）

- [x] [BEHAVIOR] Step1 写消息进短期：POST /message(租户A) → 200 ok + cs_memory_messages 5 分钟内新增（带时间窗防造假）
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "写消息进短期"'
  期望: exit 0

- [x] [BEHAVIOR] Step4 取回复上下文三层拼接 + schema keys 完整性（context==[longterm,mid,short]）+ 禁用字段反向
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "三层拼接"'
  期望: exit 0

- [x] [BEHAVIOR] Step2/3 日收尾生成中期 + 跨天并入长期 + 空天不写空中期（DB 时间窗断言）
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "日收尾"'
  期望: exit 0

- [x] [BEHAVIOR] Step5 隔离：租户A查只见A，B查只见B，DB 层跨租户泄漏 count=0（双向）
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "隔离"'
  期望: exit 0

- [x] [BEHAVIOR] Step6 error path：写/查缺 tenant_id 三端点均 400 + error=="MISSING_TENANT"，不回退不串租户
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "缺 tenant_id"'
  期望: exit 0

- [x] [BEHAVIOR] 降级：summarization（OpenRouter）失败时不破坏已有三层数据，收尾链路降级仍写非空中期
  Test: manual:bash -c 'cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "降级"'
  期望: exit 0

- [x] [BEHAVIOR] HTTP final-e2e：起真 apps/api，curl|jq 验三层 keys + 隔离 + 缺 tenant 400，psql 带 5 分钟时间窗断言落库
  Test: manual:bash -c 'bash sprints/06181529-line04-cs-memory-backend/e2e/golden-path-smoke.sh'
  期望: exit 0（脚本末尾打印 ✅ Golden Path 验证通过）
