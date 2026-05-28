---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: original_script 字段完整链路

**范围**: DB migration 3 列就绪；createJob API 读写 original_script + target_aspect + detected_aspect（响应嵌套在 .job 对象，HTTP 201）；composeTemplate 注入前缀；前端 textarea 存在
**大小**: S（< 100 行净增）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration SQL 文件存在，含 original_script / target_aspect / detected_aspect 三列
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const f=files.find(n=>n.includes('original_script'));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('original_script')||!c.includes('target_aspect')||!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/ai-video-pipeline.service.ts` createJob 参数接受 originalScript + targetAspect
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-video-pipeline.service.ts','utf8');if(!c.includes('originalScript')&&!c.includes('original_script'))process.exit(1);if(!c.includes('targetAspect')&&!c.includes('target_aspect'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/controllers/ai-video-pipeline-ai.controller.ts` 含原始文案前缀注入字符串
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');if(!c.includes('用户录制前参考文案（非逐字稿，仅意图参考）'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 前端 `apps/dashboard/src/pages/LocalVideoPipelinePage.tsx` 含 original_script 字段引用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('original_script'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] createJob POST 201 响应含 .job 嵌套对象，字段值与请求一致
  Test: manual:bash -c '
    RESP=$(curl -sf -w "\n%{http_code}" -X POST "localhost:3000/api/ai-video-pipeline/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test","original_script":"test script","target_aspect":"9:16"}'"'"')
    HTTP_CODE=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | head -1)
    [ "$HTTP_CODE" = "201" ] || { echo "FAIL: HTTP $HTTP_CODE != 201"; exit 1; }
    echo "$BODY" | jq -e '"'"'.job | type == "object"'"'"' || { echo "FAIL: 响应缺 .job 对象"; exit 1; }
    echo "$BODY" | jq -e '"'"'.job.original_script == "test script"'"'"' || { echo "FAIL: job.original_script 值错"; exit 1; }
    echo "$BODY" | jq -e '"'"'.job.target_aspect == "9:16"'"'"' || { echo "FAIL: job.target_aspect 值错"; exit 1; }
    echo "$BODY" | jq -e '"'"'.job.detected_aspect == null'"'"' || { echo "FAIL: job.detected_aspect 初始应为 null"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] createJob 响应 .job 含 id (string) — schema 完整性 + id 类型校验
  Test: manual:bash -c '
    BODY=$(curl -sf -X POST "localhost:3000/api/ai-video-pipeline/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test"}'"'"')
    echo "$BODY" | jq -e '"'"'.job.id | type == "string"'"'"' || { echo "FAIL: job.id 应为 string"; exit 1; }
    echo "$BODY" | jq -e '"'"'(.job | has("id")) and (.job | has("original_script")) and (.job | has("target_aspect")) and (.job | has("detected_aspect"))'"'"' \
      || { echo "FAIL: .job 缺少必填字段"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] createJob 响应不含禁用字段 originalScript（PRD 要求 snake_case）
  Test: manual:bash -c '
    BODY=$(curl -sf -X POST "localhost:3000/api/ai-video-pipeline/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"local_path":"C:\\\\test.mp4","topic":"test","original_script":"x","target_aspect":"16:9"}'"'"')
    echo "$BODY" | jq -e '"'"'.job | has("originalScript") | not'"'"' || { echo "FAIL: 禁用字段 originalScript 出现在 .job"; exit 1; }
    echo "$BODY" | jq -e '"'"'has("originalScript") | not'"'"' || { echo "FAIL: 禁用字段 originalScript 出现在顶层"; exit 1; }
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] composeTemplate 源码含前缀注入逻辑：original_script 非空时注入前缀字符串（含条件保护）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"apps/api/src/controllers/ai-video-pipeline-ai.controller.ts\",\"utf8\");
      if (!c.includes(\"用户录制前参考文案（非逐字稿，仅意图参考）\")) process.exit(1);
      const hasGuard = (c.includes(\"_originalScript\") || c.includes(\"original_script\") || c.includes(\"originalScript\")) &&
        (c.includes(\"? \`\") || c.includes(\"? '\") || c.includes(\"? \\\"\") || c.includes(\"Prefix\") || c.includes(\"if (\"));
      if (!hasGuard) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: composeTemplate 前缀注入逻辑未实现"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] error path — 缺少 local_path 必填参数时返回 400 + error 字段
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:3000/api/ai-video-pipeline/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"topic":"test"}'"'"')
    [ "$CODE" = "400" ] || { echo "FAIL: 缺 local_path 应返 400，实际 $CODE"; exit 1; }
    ERRRESP=$(curl -sf -X POST "localhost:3000/api/ai-video-pipeline/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
      -d '"'"'{"topic":"test"}'"'"' 2>/dev/null || true)
    echo "$ERRRESP" | jq -e '"'"'.error | type == "string"'"'"' || { echo "FAIL: 400 响应缺 error 字段"; exit 1; }
    echo OK
  '
  期望: OK
