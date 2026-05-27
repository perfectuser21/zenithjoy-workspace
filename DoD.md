contract_branch: cp-05272229-ws-96db2647-ws1
workstream_index: 1
sprint_dir: sprints/run-20260527-2037

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration + API 层新字段

**范围**: 新增 migration SQL 加三列（original_script/target_aspect/detected_aspect），更新 PipelineJob interface，createJob 接受新字段，updateProgress 接受 detected_aspect
**大小**: M（~140 行净增，3 文件）
**依赖**: 无（串行链起点）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在于 `apps/api/db/migrations/`，含 `original_script` 关键字
  Test: bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|video_pipeline_new_fields" | grep "\.sql$" | sort | tail -1); [ -n "$F" ] || { echo "FAIL: migration 文件未找到"; exit 1; }; grep -q "original_script" "apps/api/db/migrations/$F" || { echo "FAIL: 缺 original_script"; exit 1; }; echo OK'

- [ ] [ARTIFACT] migration SQL 含 `target_aspect` 列定义
  Test: bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|video_pipeline_new_fields" | grep "\.sql$" | sort | tail -1); grep -q "target_aspect" "apps/api/db/migrations/$F" || { echo "FAIL: 缺 target_aspect"; exit 1; }; echo OK'

- [ ] [ARTIFACT] migration SQL 含 `detected_aspect` 列定义
  Test: bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|video_pipeline_new_fields" | grep "\.sql$" | sort | tail -1); grep -q "detected_aspect" "apps/api/db/migrations/$F" || { echo "FAIL: 缺 detected_aspect"; exit 1; }; echo OK'

---

## BEHAVIOR 条目（runtime oracle 优先 — v7.8 两层验证架构）

- [ ] [BEHAVIOR] DB 中 ai_video_pipeline_jobs 表三列均已存在（psql runtime oracle）
  Test: manual:bash -c 'COUNT=$(psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'ai_video_pipeline_jobs'"'"' AND column_name IN ('"'"'original_script'"'"','"'"'target_aspect'"'"','"'"'detected_aspect'"'"')" 2>/dev/null | tr -d " \n"); [ "$COUNT" = "3" ] || { echo "FAIL: DB columns count=$COUNT 期望 3"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] target_aspect CHECK 约束限制 9:16 和 16:9 两值（migration SQL 字面量检查）
  Test: manual:bash -c 'F=$(ls apps/api/db/migrations/ | grep -E "original_script|video_pipeline_new_fields" | grep "\.sql$" | sort | tail -1); [ -n "$F" ] || { echo "FAIL: migration 文件未找到"; exit 1; }; grep -q '"'"'9:16'"'"' "apps/api/db/migrations/$F" && grep -q '"'"'16:9'"'"' "apps/api/db/migrations/$F" || { echo "FAIL: target_aspect CHECK 值缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/ai-video/jobs 接受 original_script + target_aspect，response 原样返回（curl+jq runtime oracle）
  Test: manual:bash -c 'TS=$(date +%s); RESP=$(curl -sf -X POST "http://localhost:5200/api/ai-video/jobs" -H "Content-Type: application/json" -d "{\"topic\":\"dod-test-${TS}\",\"local_path\":\"/tmp/test.mp4\",\"original_script\":\"script-${TS}\",\"target_aspect\":\"9:16\"}" 2>/dev/null) || { echo "FAIL: POST 请求失败（API 未运行？）"; exit 1; }; echo "$RESP" | jq -e ".original_script == \"script-${TS}\"" || { echo "FAIL: original_script 未原样返回"; exit 1; }; echo "$RESP" | jq -e ".target_aspect == \"9:16\"" || { echo "FAIL: target_aspect 未原样返回"; exit 1; }; echo "$RESP" | jq -e ".detected_aspect == null" || { echo "FAIL: detected_aspect 初始应为 null"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/ai-video/jobs/:id response 顶层包含 original_script + target_aspect + detected_aspect 三字段（keys 完整性 oracle）
  Test: manual:bash -c 'TS=$(date +%s); JID=$(curl -sf -X POST "http://localhost:5200/api/ai-video/jobs" -H "Content-Type: application/json" -d "{\"topic\":\"keys-test-${TS}\",\"local_path\":\"/tmp/t.mp4\",\"original_script\":\"s\",\"target_aspect\":\"16:9\"}" 2>/dev/null | jq -r ".id") || { echo "FAIL: POST 失败"; exit 1; }; RESP=$(curl -sf "http://localhost:5200/api/ai-video/jobs/${JID}" 2>/dev/null) || { echo "FAIL: GET 失败"; exit 1; }; echo "$RESP" | jq -e '"'"'has("original_script") and has("target_aspect") and has("detected_aspect")'"'"' || { echo "FAIL: 三字段未全返回"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/ai-video/jobs response 不含禁用字段（aspectRatio / aspect_ratio / script / raw_script / source_script）
  Test: manual:bash -c 'TS=$(date +%s); RESP=$(curl -sf -X POST "http://localhost:5200/api/ai-video/jobs" -H "Content-Type: application/json" -d "{\"topic\":\"banned-test-${TS}\",\"local_path\":\"/tmp/t.mp4\"}" 2>/dev/null) || { echo "FAIL: POST 失败"; exit 1; }; for b in aspectRatio aspect_ratio script raw_script source_script; do echo "$RESP" | jq -e "has(\"$b\") | not" || { echo "FAIL: 禁用字段 $b 存在"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PipelineJob TypeScript interface 含 original_script / target_aspect / detected_aspect 三字段（interface 定义检查）
  Test: manual:bash -c 'SVC="apps/api/src/services/ai-video-pipeline.service.ts"; for f in original_script target_aspect detected_aspect; do grep -q "$f" "$SVC" || { echo "FAIL: PipelineJob interface 缺 $f"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] updateProgress controller 接受 detected_aspect 字段并转发给 service（controller 代码检查）
  Test: manual:bash -c 'C="apps/api/src/controllers/ai-video-pipeline.controller.ts"; grep -q "detected_aspect" "$C" || { echo "FAIL: updateProgress 缺 detected_aspect"; exit 1; }; echo OK'
  期望: OK
