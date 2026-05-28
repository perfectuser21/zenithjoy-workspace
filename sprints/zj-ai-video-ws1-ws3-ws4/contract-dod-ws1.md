---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: original_script 字段完整链路

**范围**: DB migration 3 列就绪；createJob API 读写 original_script + target_aspect + detected_aspect；composeTemplate 注入前缀；前端 textarea 存在
**大小**: S（< 100 行净增）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration SQL 文件存在，含 original_script / target_aspect / detected_aspect 三列
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const f=files.find(n=>n.includes('original_script'));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('original_script')||!c.includes('target_aspect')||!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/ai-video-pipeline.service.ts` createJob 参数含 originalScript + targetAspect
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');if(!c.includes('originalScript')||!c.includes('targetAspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/controllers/ai-video-pipeline-ai.controller.ts` 含 _originalScript + originalScriptPrefix
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('_originalScript')||!c.includes('originalScriptPrefix'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 前端 `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx` 含 name="original_script" textarea
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] createJob service 返回 job 含 original_script 字段（值原样存储）
  Test: manual:bash -c '
    TEST_JOB_ID=$(psql "$DB" -t -c "
      INSERT INTO zenithjoy.ai_video_pipeline_jobs
        (src_video, topic, original_script, status, progress)
      VALUES ('\''C:\\test.mp4'\'', '\''test topic'\'', '\''录制前文案示例'\'', '\''pending'\'', 0)
      RETURNING id
    " | tr -d " \n")
    RESULT=$(psql "$DB" -t -c "SELECT original_script FROM zenithjoy.ai_video_pipeline_jobs WHERE id='"'"'$TEST_JOB_ID'"'"'" | tr -d " \n")
    [ "$RESULT" = "录制前文案示例" ] || { echo "FAIL: original_script 值 expected=录制前文案示例 got=$RESULT"; exit 1; }
    psql "$DB" -c "DELETE FROM zenithjoy.ai_video_pipeline_jobs WHERE id='"'"'$TEST_JOB_ID'"'"'"
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] createJob API POST 响应含 original_script + target_aspect + detected_aspect（snake_case），不含 originalScript
  Test: manual:bash -c '
    RESP=$(curl -sf -X POST "localhost:3000/api/ai-video/jobs" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test","original_script":"test script","target_aspect":"9:16"}'"'"')
    echo "$RESP" | jq -e ".original_script == \"test script\"" || { echo "FAIL: original_script 字段值错"; exit 1; }
    echo "$RESP" | jq -e ".target_aspect == \"9:16\"" || { echo "FAIL: target_aspect 字段值错"; exit 1; }
    echo "$RESP" | jq -e ".detected_aspect == null" || { echo "FAIL: detected_aspect 初始应为 null"; exit 1; }
    echo "$RESP" | jq -e "has(\"originalScript\") | not" || { echo "FAIL: 禁用字段 originalScript 出现"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] createJob API 响应 schema 完整性：必须含 original_script + target_aspect + detected_aspect + id + status
  Test: manual:bash -c '
    RESP=$(curl -sf -X POST "localhost:3000/api/ai-video/jobs" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test"}'"'"')
    echo "$RESP" | jq -e "has(\"original_script\") and has(\"target_aspect\") and has(\"detected_aspect\") and has(\"id\") and has(\"status\")" || { echo "FAIL: 缺少必要字段"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] composeTemplate 源码含前缀注入逻辑：_originalScript 非空时前缀"用户录制前参考文案（非逐字稿，仅意图参考）："出现在 prompt 中
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");
      if (!c.includes(\"用户录制前参考文案（非逐字稿，仅意图参考）\")) process.exit(1);
      const hasGuard = c.includes(\"_originalScript\") && (c.includes(\"? \`\") || c.includes(\"? \\\"\") || c.includes(\"originalScriptPrefix\"));
      if (!hasGuard) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: composeTemplate 前缀注入逻辑未实现"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] error path — 传入禁用字段 aspectRatio 时响应不含 aspectRatio（API 忽略无关字段）
  Test: manual:bash -c '
    RESP=$(curl -sf -X POST "localhost:3000/api/ai-video/jobs" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test","aspectRatio":"9:16"}'"'"')
    echo "$RESP" | jq -e "has(\"aspectRatio\") | not" || { echo "FAIL: 禁用字段 aspectRatio 出现在响应中"; exit 1; }
    echo OK
  '
  期望: OK
