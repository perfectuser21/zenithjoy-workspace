---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 比例选择 + 画幅检测（ffprobe + Agent + 前端）

**范围**: 前端比例选择器 + createJob 携带 target_aspect；Agent ffprobe 读 width/height + rotation swap → detectedAspect → PATCH /api/ai-video-pipeline/:id/progress 写回；effectiveTarget 只生成单文件
**大小**: M（~120 行净增，2 文件）
**依赖**: Workstream 1 完成后（DB migration 列已就绪）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] 前端 LocalVideoPipelinePage.tsx 含比例选择器 UI + target_aspect 写入 createJob 请求
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');if(!c.includes('target_aspect'))process.exit(1);if(!c.includes('9:16')&&!c.includes('16:9'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] Agent video-pipeline.ts 含 detectedAspect + effectiveTarget 变量声明
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('detectedAspect'))process.exit(1);if(!c.includes('effectiveTarget'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] Agent video-pipeline.ts 含 PATCH detected_aspect 写回调用
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('detected_aspect'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] Agent handler 含 effectiveWidth/effectiveHeight + rotation=90°/270° swap 逻辑
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");
      if (!c.includes(\"effectiveWidth\") || !c.includes(\"effectiveHeight\")) process.exit(1);
      const hasSwap = c.includes(\"rotation\") && (c.includes(\"90\") || c.includes(\"270\")) && c.includes(\"effectiveWidth\");
      if (!hasSwap) process.exit(1);
      if (!c.includes(\"detectedAspect\")) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: Agent 缺 effectiveWidth/effectiveHeight/rotation swap 逻辑"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] Agent handler effectiveTarget 逻辑存在：target_aspect ?? detectedAspect ?? "9:16"，且含单文件生成分支
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");
      if (!c.includes(\"effectiveTarget\")) process.exit(1);
      const hasCoalesce = c.includes(\"target_aspect\") && c.includes(\"detectedAspect\") && c.includes(\"effectiveTarget\");
      if (!hasCoalesce) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: effectiveTarget 逻辑未实现"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] PATCH /api/ai-video-pipeline/:id/progress 接受 detected_aspect 并写库（带时间窗口）
  Test: manual:bash -c '
    TEST_JOB_ID=$(psql "$DB" -t -c "
      INSERT INTO zenithjoy.ai_video_pipeline_jobs
        (src_video, topic, status, progress)
      VALUES ('"'"'C:\\test.mp4'"'"', '"'"'test'"'"', '"'"'processing'"'"', 20)
      RETURNING id
    " | tr -d " \n")
    curl -sf -X PATCH "localhost:3000/api/ai-video-pipeline/$TEST_JOB_ID/progress" \
      -H "Content-Type: application/json" \
      -d "{\"progress\":35,\"status\":\"processing\",\"detected_aspect\":\"9:16\"}" || { echo "FAIL: PATCH 请求失败"; exit 1; }
    RESULT=$(psql "$DB" -t -c "SELECT detected_aspect FROM zenithjoy.ai_video_pipeline_jobs WHERE id='"'"'$TEST_JOB_ID'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " \n")
    [ "$RESULT" = "9:16" ] || { echo "FAIL: detected_aspect 写回失败 got=$RESULT"; exit 1; }
    psql "$DB" -c "DELETE FROM zenithjoy.ai_video_pipeline_jobs WHERE id='"'"'$TEST_JOB_ID'"'"'"
    echo OK
  '
  期望: OK

- [ ] [BEHAVIOR] 前端 LocalVideoPipelinePage createJob 调用携带 target_aspect 字段（源码验证）
  Test: manual:bash -c '
    node -e "
      const c = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/LocalVideoPipelinePage.tsx\",\"utf8\");
      if (!c.includes(\"target_aspect\")) process.exit(1);
      const apiCallBlock = c.match(/axios\\.post[\s\S]{0,500}target_aspect/) ||
        c.match(/fetch[\s\S]{0,500}target_aspect/) ||
        c.match(/api[\s\S]{0,300}target_aspect/);
      if (!apiCallBlock) process.exit(1);
      console.log(\"OK\");
    " || { echo "FAIL: 前端 createJob 未携带 target_aspect"; exit 1; }
  '
  期望: OK

- [ ] [BEHAVIOR] PATCH 响应禁用字段 aspectRatio/aspect/ratio/orientation 全部不出现（4 个禁用字段）
  Test: manual:bash -c '
    TEST_JOB_ID=$(psql "$DB" -t -c "
      INSERT INTO zenithjoy.ai_video_pipeline_jobs (src_video, topic, status, progress) VALUES ('"'"'C:\\test.mp4'"'"', '"'"'t'"'"', '"'"'processing'"'"', 10) RETURNING id
    " | tr -d " \n")
    RESP=$(curl -sf -X PATCH "localhost:3000/api/ai-video-pipeline/$TEST_JOB_ID/progress" \
      -H "Content-Type: application/json" \
      -d "{\"progress\":35,\"detected_aspect\":\"16:9\"}")
    echo "$RESP" | jq -e '"'"'has("aspectRatio") | not'"'"' || { echo "FAIL: 禁用字段 aspectRatio"; exit 1; }
    echo "$RESP" | jq -e '"'"'has("aspect") | not'"'"' || { echo "FAIL: 禁用字段 aspect"; exit 1; }
    echo "$RESP" | jq -e '"'"'has("ratio") | not'"'"' || { echo "FAIL: 禁用字段 ratio"; exit 1; }
    echo "$RESP" | jq -e '"'"'has("orientation") | not'"'"' || { echo "FAIL: 禁用字段 orientation"; exit 1; }
    psql "$DB" -c "DELETE FROM zenithjoy.ai_video_pipeline_jobs WHERE id='"'"'$TEST_JOB_ID'"'"'"
    echo OK
  '
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Agent E2E 全链路：detectedAspect 计算后 PATCH 写回，effectiveTarget 只生成单文件
  Screenshots:
    - ws2-01-ffprobe.png    期望：Agent 控制台输出含 detectedAspect 计算结果（9:16 或 16:9）
    - ws2-02-patch.png      期望：PATCH 请求成功，API 返回 detected_aspect 有值
    - ws2-03-output.png     期望：输出目录只含 1 个视频文件（与 effectiveTarget 对应）
  期望：所有截图与期望描述一致；agent-e2e-video.yml GHA run 绿灯
