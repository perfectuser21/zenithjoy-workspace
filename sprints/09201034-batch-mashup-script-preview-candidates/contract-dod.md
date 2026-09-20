---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 批量混剪加厚（文案动态分段 + 素材在线预览 + 候选200+可视化浏览）

**范围**: 新增 `POST /api/mashup/templates/from-script`（文案→动态分段模板，AI 失败静默降级）+ `GET /api/materials/:id/preview-url`（素材在线预览重签）；扩展候选生成产出 `thumbnailCollageUrl`（targetCount=200 可视化虚拟滚动）；扩展渲染为并发=1 队列 + 失败态（新建 `zenithjoy.mashup_render_jobs` 表）；Dashboard `MashupPage.tsx` 三处交互。**不改** S4 内容安全逻辑 / 声音克隆。
**大小**: L

> 运行环境：evaluator 在 target_environment=linux_server（hk-vps 测试库 `$E2E_DATABASE_URL`/`$PGURL`、真 ffmpeg、TOAPIS 凭据）上，先跑 `## E2E 验收` 建立上下文（export `$BASE_URL $PGURL $TOKEN $TENANT_ID $TID $RID $CID_A $M1`），下列 [BEHAVIOR] 为其中关键断言的可复跑镜像。ffprobe 类断言自包含。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增文案分段服务模块 `mashup-script-segment.ts`（含角色→ai_tags 映射 + fallback）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/mashup-script-segment.ts','utf8');if(!c.includes('roleMatched')||!/fallback/.test(c))process.exit(1)"
- [ ] [ARTIFACT] 新增缩略图拼贴模块 `mashup-thumbnail.ts` 与渲染并发闸模块 `render-concurrency.ts`
  Test: node -e "require('fs').accessSync('apps/api/src/services/mashup-thumbnail.ts');require('fs').accessSync('apps/api/src/services/render-concurrency.ts')"
- [ ] [ARTIFACT] 新建渲染任务状态机迁移 `mashup_render_jobs`（status queued/rendering/done/failed + queue_position）
  Test: bash -c 'ls apps/api/db/migrations/*mashup_render_jobs*.sql >/dev/null 2>&1 && grep -qiE "queued|rendering|failed" apps/api/db/migrations/*mashup_render_jobs*.sql'
- [ ] [ARTIFACT] 回流 GP smoke（推进 line05/batch_mashup#step3 触碰校验 + 铁律 1/5）：candidate-generation-smoke 断言 thumbnailCollageUrl；render-smoke 断言并发=1
  Test: bash -c 'grep -q "thumbnailCollageUrl" .github/workflows/scripts/smoke/mashup-candidate-generation-smoke.sh && grep -qiE "rendering|queued|concurren" .github/workflows/scripts/smoke/mashup-render-smoke.sh'
- [ ] [ARTIFACT] 凭据安全（铁律 [凭据安全]）：TOAPIS key 从 env/creds 读，源码无硬编码 key 字面值
  Test: bash -c '! grep -rnE "sk-[A-Za-z0-9]{20,}|TOAPIS_API_KEY *= *[\x27\"][A-Za-z0-9]" apps/api/src/services/mashup-script-segment.ts 2>/dev/null'

## BEHAVIOR 条目（五行剧本，evaluator 在 E2E 上下文真执行；[L1|L2|L3] 已标注）

- [ ] [BEHAVIOR] [L3] B-01: 文案粘贴触发真 TOAPIS 分段并落库（规则B 第三方真调一次）[接缝×2]
  动作: 带真 TOAPIS 凭据 POST /api/mashup/templates/from-script，body script 为一段含钩子/产品/证据/CTA 语义的文案
  预期观察: within 30s 返回 source=ai（凭据可用时）或 fallback（不可用时），segments≥1 每段含 roleMatched 且 suggestedMaterialCount≥1，zenithjoy.mashup_templates 5 分钟内新增该行
  等待预算: 30s
  留证: 命令输出末 5 行（含 source 值）+ psql count 输出
  Test: manual:bash -c 'FS=$(curl -fs -m 30 -H "X-Upload-Token: $TOKEN" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/templates/from-script" -d "{\"script\":\"开场悬念钩子，产品特写细节，使用效果对比证据，行动号召引导下单\"}"); echo "$FS" | jq -e ".success==true and (.data.templateId|type==\"string\") and (.data.segments|length>=1) and (.data.source==\"ai\" or .data.source==\"fallback\") and ([.data.segments[]|has(\"roleMatched\") and (.suggestedMaterialCount>=1)]|all)" || exit 1; TID=$(echo "$FS" | jq -r ".data.templateId"); psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_templates WHERE id=\x27$TID\x27 AND created_at > NOW() - INTERVAL \x275 minutes\x27" | grep -qx 1 || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 候选 targetCount=200 返回条数≤200 且每条含 thumbnailCollageUrl key
  动作: POST /api/mashup/runs/$RID/candidates body {"targetCount":200}
  预期观察: candidates 长度介于 1 与 200 之间（去重后如实值，决策 3ed368c3），每条候选对象都含 thumbnailCollageUrl 键（可为 null）
  等待预算: 20s
  留证: 命令输出（候选数 + all(has thumbnailCollageUrl) 判定）
  Test: manual:bash -c 'C=$(curl -fs -m 20 -H "X-Upload-Token: $TOKEN" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/runs/$RID/candidates" -d "{\"targetCount\":200}"); echo "$C" | jq -e "(.data.candidates|length>=1) and (.data.candidates|length<=200) and ([.data.candidates[]|has(\"thumbnailCollageUrl\")]|all)" || exit 1; echo OK'

- [ ] [BEHAVIOR] [L3] B-03: 渲染并发=1，第二个并发渲染进入 queued 排队态 [接缝×2]
  动作: 对两个候选近乎同时 POST /candidates/:id/render，持续采样 mashup_render_jobs 表
  预期观察: within 40s 采样期内 status=rendering 的 job 任一时刻至多 1 行（并发实测=1），且出现过 status=queued 的行（第 N 位）
  等待预算: 40s
  留证: MAXC（rendering 峰值）与 SAWQ（是否见过 queued）输出
  Test: manual:bash -c 'curl -fs -H "X-Upload-Token: $TOKEN" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/candidates/$CID_A/render" -d "{}" >/dev/null & curl -fs -H "X-Upload-Token: $TOKEN" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/candidates/${CID_B:-$CID_A}/render" -d "{}" >/dev/null & MAXC=0; SAWQ=0; for i in $(seq 1 40); do C=$(psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id=\x27$TENANT_ID\x27 AND status=\x27rendering\x27" | tr -d " "); [ "${C:-0}" -gt "$MAXC" ] && MAXC="${C:-0}"; Q=$(psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id=\x27$TENANT_ID\x27 AND status=\x27queued\x27" | tr -d " "); [ "${Q:-0}" -ge 1 ] && SAWQ=1; sleep 1; done; wait 2>/dev/null; [ "$MAXC" -le 1 ] || { echo "FAIL: 并发 $MAXC>1"; exit 1; }; [ "$SAWQ" = 1 ] || { echo "FAIL: 未见 queued"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 素材在线预览端点返回可用 signedUrl
  动作: GET /api/materials/$M1/preview-url
  预期观察: 返回 previewUrl 为非空字符串（前端据此渲染 <video>）
  等待预算: 0s
  留证: 命令输出（previewUrl 类型与长度判定）
  Test: manual:bash -c 'curl -fs -H "X-Upload-Token: $TOKEN" "$BASE_URL/api/materials/$M1/preview-url" | jq -e ".success==true and (.data.previewUrl|type==\"string\") and (.data.previewUrl|length>0)" || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: 渲染管线 ffmpeg 产物含 video+audio 流（视频领域 oracle，自包含）
  动作: lavfi 造两段带音轨测试素材，经 concatAndScale 合成，ffprobe 探流
  预期观察: 输出 mp4 同时含 video 与 audio 流（duration>0）
  等待预算: 0s
  留证: ffprobe -show_entries stream=codec_type JSON 输出
  Test: manual:bash -c 'ffmpeg -f lavfi -i "testsrc2=duration=1:size=640x480:rate=15" -f lavfi -i "sine=frequency=440:duration=1" -shortest -y /tmp/dod-a.mp4 >/dev/null 2>&1; ffmpeg -f lavfi -i "testsrc=duration=1:size=320x240:rate=15" -f lavfi -i "sine=frequency=880:duration=1" -shortest -y /tmp/dod-b.mp4 >/dev/null 2>&1; OK=$(node -e "const {concatAndScale}=require(\"./apps/api/dist/services/mashup-render-ffmpeg.js\");process.stdout.write(concatAndScale([\"/tmp/dod-a.mp4\",\"/tmp/dod-b.mp4\"],\"/tmp/dod-out.mp4\")?\"yes\":\"no\")"); [ "$OK" = yes ] || exit 1; ffprobe -v error -show_entries stream=codec_type -of json /tmp/dod-out.mp4 | jq -e "[.streams[].codec_type]|(index(\"video\") and index(\"audio\"))" || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: error path — from-script 空 script 返 400（不 500、不挂起）
  动作: POST /api/mashup/templates/from-script body {"script":""}
  预期观察: HTTP 400，error.code=INVALID_BODY
  等待预算: 5s
  留证: HTTP 状态码 + error.code 输出
  Test: manual:bash -c 'CODE=$(curl -s -m 5 -o /tmp/dod-err.json -w "%{http_code}" -H "X-Upload-Token: $TOKEN" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/templates/from-script" -d "{\"script\":\"\"}"); [ "$CODE" = 400 ] || { echo "FAIL: code=$CODE"; exit 1; }; jq -e ".error.code==\"INVALID_BODY\"" /tmp/dod-err.json || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1 铁律[租户隔离]: 跨租户 token 拿不到别人的候选（render 越权 → 404）
  动作: 用另一租户 token（$TOKEN_OTHER，evaluator 播种第二租户）对本租户候选 $CID_A POST render
  预期观察: HTTP 404 CANDIDATE_NOT_FOUND，不泄露候选存在性、不越权渲染
  等待预算: 5s
  留证: HTTP 状态码输出
  Test: manual:bash -c 'CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -H "X-Upload-Token: ${TOKEN_OTHER:-ZJ-NOBODY}" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/candidates/$CID_A/render" -d "{}"); [ "$CODE" = 404 ] || [ "$CODE" = 401 ] || { echo "FAIL: 跨租户 code=$CODE 应 404/401"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 铁律[端点鉴权]: 新端点无 X-Upload-Token → 401
  动作: 无 token GET /api/materials/<any>/preview-url 与 POST /templates/from-script
  预期观察: 两者均 HTTP 401 UNAUTHORIZED
  等待预算: 5s
  留证: 两个 HTTP 状态码输出
  Test: manual:bash -c 'C1=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE_URL/api/materials/00000000-0000-4000-8000-000000000000/preview-url"); C2=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -H "content-type: application/json" -X POST "$BASE_URL/api/mashup/templates/from-script" -d "{\"script\":\"x\"}"); [ "$C1" = 401 ] && [ "$C2" = 401 ] || { echo "FAIL: c1=$C1 c2=$C2"; exit 1; }; echo OK'

## 铁律映射补充（Step 1.3 — 逐条铁律去向）

- 铁律[单slot串行]: N/A — 本 sprint 渲染并发闸是 **run 级并发=1**（保护 hk-vps 4 核），不触及「单 slot 串行/跨 slot 并行」的槽位任务模型，未改动该不变量覆盖的模块。
- 铁律[日志脱敏]: 见 ARTIFACT「凭据安全」+ 沿用现有 mashup-render.ts 的 candidateId 不进格式串首参写法；from-script 不 console.error 明文 script 全文。
- 铁律[禁写死环境值]: 由 B-02 保证（候选数如实 ≤targetCount，不承诺死 200）+ targetCount 服务端夹到 HARD_MAX_TARGET_COUNT=300（现有逻辑）。
- 铁律[真环境验证]: 由 target_environment=linux_server 的 `## E2E 验收` 真机（真 ffmpeg/真 TOAPIS/真 PG）满足；接缝断言不在 mock/CI 绿处判 done。
- 铁律[测试多租户]: integration 测试 + INV-1 覆盖跨租户隔离（默认多租户）。

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，截图存 ${SPRINT_DIR}/screenshots/）

- [ ] [BEHAVIOR:E2E] 客户完整走完 Golden Path（粘贴文案→确认分段→在线预览挑素材→刷候选→选中渲染），截图可视化验证
  Screenshots:
    - 01-script-segments.png   期望：粘贴文案后出现动态分段模板确认界面，各段角色/建议素材数可见（兜底映射项有标注）
    - 02-pick-preview.png      期望：PickStep 素材卡片可点击，出现 `<video>` 在线播放预览
    - 03-candidates-scroll.png 期望：候选步骤呈现缩略图拼贴卡片，虚拟滚动（DOM 节点数 ≈ 可视区，非全量 200）
    - 04-render-queue.png      期望：选中候选后触发渲染，出现渲染中/排队「第 N 位」或渲染失败可重渲的状态
  期望：所有截图与期望描述一致，Claude Read 图自验通过；evaluator 完成后 cp screenshots/*.png ${SPRINT_DIR}/screenshots/
