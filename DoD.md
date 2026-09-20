contract_branch: cp-harness-propose-r1-36dfcb8e-r4d26d994-a7
sprint_dir: sprints/09201034-batch-mashup-script-preview-candidates

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 批量混剪加厚（文案动态分段 + 素材在线预览 + 候选 200+ 可视化浏览 + 按需渲染）

**范围**: apps/api 分段/预览/候选/渲染队列服务 + 迁移 + apps/dashboard MashupPage 文案输入/在线预览/虚拟滚动/渲染队列 UI
**大小**: L
**target_environment**: linux_server（hk-vps 真机；B-* 中 [L3] 条目由 final-e2e 在 hk-vps 真跑，[L2] 条目 evaluator 逐条真跑）

> 环境变量（Fleet/hk-vps 注入，late-bound，脚本内不写 UUID 字面值）：`API_BASE`/`DB_URL`/`UPLOAD_TOKEN`/`OTHER_TENANT_TOKEN`/`MATERIAL_ID`/`RUN_ID`/`CAND_A`/`CAND_B`/`TEMPLATE_ID` 由 `## E2E 验收` 脚本前序步骤建立并导出后供 [L3] 复合条目复用；[L2] 条目自带最小上下文。

## ARTIFACT 条目

- [ ] [ARTIFACT] 数据库迁移新增候选渲染态与缩略图列
  Test: node -e "const fs=require('fs');const g=fs.readdirSync('apps/api/db/migrations').map(f=>fs.readFileSync('apps/api/db/migrations/'+f,'utf8')).join('\n');if(!/render_status/.test(g)||!/thumbnail_url/.test(g))process.exit(1)"
  期望: exit 0（存在含 render_status + thumbnail_url 的迁移）

- [ ] [ARTIFACT] from-script 分段服务实现存在
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/mashup-slot-assignment.ts','utf8');if(!/from-script|generateTemplateFromScript|segmentScript/.test(c)&&!require('fs').existsSync('apps/api/src/services/mashup-script-segment.ts'))process.exit(1)"
  期望: exit 0（分段生成实现落在 mashup-slot-assignment.ts 或 mashup-script-segment.ts）

- [ ] [ARTIFACT] 渲染队列并发=1 实现存在
  Test: node -e "const fs=require('fs');const has=fs.existsSync('apps/api/src/services/mashup-render-queue.ts')||/queuePosition|concurrency|并发/.test(fs.readFileSync('apps/api/src/services/mashup-render.ts','utf8'));if(!has)process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] smoke 回流（GP-Anchor 触碰校验 + 铁律 #5）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/mashup-candidate-generation-smoke.sh','utf8');if(!/render_status|thumbnail|generatedCount|targetCount/.test(c))process.exit(1)"
  期望: exit 0（候选 smoke 回流新断言）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 粘贴文案返回动态分段模板并落库
  动作: POST /api/mashup/templates/from-script 传一段真实文案，服务真调 TOAPIS/Gemini 解析（hk-vps 有真 key）
  预期观察: 返回 slots 为非空数组、每段含 suggestedCount、source 为 ai 或诚实 fallback、degraded 为布尔；对应 mashup_templates 行 5 分钟内落库
  等待预算: 20s（AI 调用超时窗）
  留证: 命令输出（templateId + source）+ psql 落库计数
  Test: manual:bash -c 'R=$(curl -sf -m 20 -X POST "$API_BASE/api/mashup/templates/from-script" -H "X-Upload-Token: $UPLOAD_TOKEN" -H "Content-Type: application/json" -d "{\"script\":\"开场抛痛点中段展示产品卖点与效果结尾行动号召下单\"}"); echo "$R" | jq -e "(.data.slots|type==\"array\") and (.data.slots|length>=1) and (.data.slots[0].suggestedCount|type==\"number\") and (.data.degraded|type==\"boolean\") and (.data.source|test(\"^(ai|fallback)$\"))" || exit 1; T=$(echo "$R" | jq -r ".data.templateId"); psql "$DB_URL" -tAc "SELECT 1 FROM zenithjoy.mashup_templates WHERE id='"'"'$T'"'"' AND created_at > NOW()-INTERVAL '"'"'5 minutes'"'"'" | grep -qx 1 || { echo FAIL-no-row; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 文案缺失返回 400（error path，不 500 裸崩）
  动作: POST /api/mashup/templates/from-script 传空 script
  预期观察: HTTP 400，响应体含 error.code 字符串，不返回 500
  等待预算: 0s
  留证: 状态码 + error.code
  Test: manual:bash -c 'C=$(curl -s -o /tmp/b02.json -w "%{http_code}" -X POST "$API_BASE/api/mashup/templates/from-script" -H "X-Upload-Token: $UPLOAD_TOKEN" -H "Content-Type: application/json" -d "{\"script\":\"\"}"); [ "$C" = "400" ] || { echo "FAIL code=$C"; exit 1; }; jq -e ".error.code|type==\"string\"" /tmp/b02.json || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 素材在线预览重签返回 previewUrl/previewAvailable/expiresAt
  动作: GET /api/materials/$MATERIAL_ID/preview（本租户凭据）
  预期观察: 200，data.materialId 匹配，previewAvailable 为布尔，previewUrl 为字符串或 null，expiresAt 为字符串
  等待预算: 0s
  留证: 命令输出（previewAvailable + expiresAt）
  Test: manual:bash -c 'R=$(curl -sf "$API_BASE/api/materials/$MATERIAL_ID/preview" -H "X-Upload-Token: $UPLOAD_TOKEN"); echo "$R" | jq -e ".data.materialId==\"$MATERIAL_ID\" and (.data.previewAvailable|type==\"boolean\") and (.data.previewUrl|(type==\"string\" or .==null)) and (.data.expiresAt|type==\"string\")" || exit 1; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 跨租户预览返回 404（INV-1 租户隔离）
  动作: 用另一租户 token 请求同一 $MATERIAL_ID preview
  预期观察: HTTP 404（素材对非属主租户不可见）
  等待预算: 0s
  留证: 状态码
  Test: manual:bash -c '[ -n "$OTHER_TENANT_TOKEN" ] || { echo "SKIP-no-other-token"; exit 0; }; C=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/materials/$MATERIAL_ID/preview" -H "X-Upload-Token: $OTHER_TENANT_TOKEN"); [ "$C" = "404" ] || { echo "FAIL cross-tenant code=$C"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L3] B-05: 候选生成 targetCount=200 懒渲染（全 pending + 缩略图 + generatedCount）
  动作: POST /api/mashup/runs/$RUN_ID/candidates 传 targetCount=200
  预期观察: candidates 长度<=200，每条 renderStatus 恒为 pending（生成期零真实渲染），至少部分含 thumbnailUrl，generatedCount 为数字；DB 中该 run 无任何成片 contents
  等待预算: 60s（候选生成含 embedding 计算）
  留证: 命令输出（generatedCount）+ psql 成片计数=0
  Test: manual:bash -c 'G=$(curl -sf -m 60 -X POST "$API_BASE/api/mashup/runs/$RUN_ID/candidates" -H "X-Upload-Token: $UPLOAD_TOKEN" -H "Content-Type: application/json" -d "{\"targetCount\":200}"); echo "$G" | jq -e "(.data.generatedCount|type==\"number\") and ((.data.candidates|length)<=200) and (all(.data.candidates[]; .renderStatus==\"pending\")) and (any(.data.candidates[]; .thumbnailUrl!=null))" || exit 1; P=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents c JOIN zenithjoy.mashup_candidates mc ON mc.id=c.source_candidate_id WHERE mc.run_id='"'"'$RUN_ID'"'"'" | tr -d " "); [ "$P" = "0" ] || { echo "FAIL 生成期已渲染=$P"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L3] B-06: 按需渲染并发上限=1，第二个请求进入排队 [接缝×2]
  动作: 并行 POST 两条 candidate 的 /render
  预期观察: 两响应中恰有 renderStatus=queued 至少一条（并发实测=1，第二个排队显示 queuePosition>=1）
  等待预算: 15s
  留证: 两次 render 响应 JSON（含 renderStatus/queuePosition）
  Test: manual:bash -c 'A=$(mktemp); B=$(mktemp); curl -sf -m 15 -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" >"$A" & curl -sf -m 15 -X POST "$API_BASE/api/mashup/candidates/$CAND_B/render" -H "X-Upload-Token: $UPLOAD_TOKEN" >"$B" & wait; Q=$(cat "$A" "$B" | jq -rs "[.[]|.data.renderStatus]|map(select(.==\"queued\"))|length"); [ "${Q:-0}" -ge 1 ] || { echo "FAIL 并发>1 无 queued"; cat "$A" "$B"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L3] B-07: 渲染终态为真实成片或失败可重试（INV-6 防假成功 / INV-2 真机）[接缝×2]
  动作: 轮询 $CAND_A 渲染直到 rendered 或 render_failed，within 8 分钟
  预期观察: rendered → contents.export_url 非空且 ffprobe 有 video 流+duration>0（-an 无音轨不验 audio）；render_failed → 再次 POST 可重新入队非死路
  等待预算: 480s
  留证: ffprobe probe.json（video 流 + duration）或重试后 renderStatus
  Test: manual:bash -c 'D=$((SECONDS+480)); F=""; until [ -n "$F" ]; do S=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" | jq -r ".data.renderStatus"); case "$S" in rendered|render_failed) F="$S";; esac; [ $SECONDS -lt $D ] || { echo "FAIL 8min 未终态 last=$S"; exit 1; }; [ -n "$F" ] || sleep 5; done; if [ "$F" = render_failed ]; then R=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" | jq -r ".data.renderStatus"); echo "$R" | grep -Eq "^(queued|rendering|rendered)$" || { echo "FAIL 失败态不可重试=$R"; exit 1; }; echo "OK-retry"; else E=$(psql "$DB_URL" -tAc "SELECT export_url FROM zenithjoy.contents WHERE source_candidate_id='"'"'$CAND_A'"'"' AND export_url IS NOT NULL AND created_at>NOW()-INTERVAL '"'"'10 minutes'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); [ -n "$E" ] || { echo "FAIL rendered 但 export_url 空(假成功)"; exit 1; }; T=$(mktemp); curl -sf "$E" -o "$T.mp4"; ffprobe -v error -show_entries stream=codec_type -show_entries format=duration -of json "$T.mp4" >"$T.json"; jq -e "([.streams[].codec_type]|index(\"video\")) and ((.format.duration|tonumber)>0)" "$T.json" || { echo FAIL-not-real-video; exit 1; }; echo OK-rendered; fi'

## Invariant 铁律覆盖（历史约束三源 — 铁律清单逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [租户隔离] 模板/素材/候选跨租户不可见
  Test: manual:bash -c '[ -n "$OTHER_TENANT_TOKEN" ] || { echo SKIP; exit 0; }; C=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/mashup/runs/$RUN_ID/candidates" -H "X-Upload-Token: $OTHER_TENANT_TOKEN"); [ "$C" = "404" ] || { echo "FAIL 跨租户候选可见 code=$C"; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L3] INV-2 [真环境验证] 成片真实性由 hk-vps ffprobe 验证 —— 由 B-07 rendered 分支 ffprobe 断言覆盖（真机才判 done，禁写死环境假设值）
  Test: manual:bash -c 'echo "covered-by B-07 ffprobe(video stream+duration) on hk-vps; 无独立命令"; true'
- [ ] [BEHAVIOR] [L3] INV-3 [渲染并发=1] 单 slot 串行 —— 由 B-06 并发两请求恰一 queued 断言覆盖
  Test: manual:bash -c 'echo "covered-by B-06 concurrency=1 assertion"; true'
- [ ] [BEHAVIOR] [L2] INV-4 [凭据安全] TOAPIS/Gemini 凭据不硬编码（源码静态扫描无明文 key、端点需鉴权）
  Test: manual:bash -c 'if grep -rEn "sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{20,}" apps/api/src/services/mashup-*.ts apps/api/src/routes/mashup.ts 2>/dev/null | grep -v "process.env"; then echo FAIL-hardcoded-key; exit 1; fi; C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/mashup/templates/from-script" -H "Content-Type: application/json" -d "{\"script\":\"x\"}"); [ "$C" = "401" ] || { echo "FAIL 未鉴权 code=$C"; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] INV-5 [内容安全自查] 成片经 S4 内容安全自查后才呈现 —— N/A（本 sprint 不改 S4 内容安全逻辑，沿用现有 mashup-render.ts fail-closed；由 B-07 export_url 非空隐含要求 safety=passed）
  Test: manual:bash -c 'grep -q "safety_check_status" apps/api/src/services/mashup-render.ts || { echo "FAIL: S4 内容安全 gate 被移除"; exit 1; }; echo OK-S4-unchanged'
- [ ] [BEHAVIOR] [L3] INV-6 [防假成功] 渲染须确认真实产出成片才判成功 —— 由 B-07 rendered 分支 export_url 非空 + ffprobe 覆盖（失败落 render_failed 而非假绿）
  Test: manual:bash -c 'echo "covered-by B-07: rendered→export_url 非空 + ffprobe(video+duration); 失败→render_failed 非假绿"; true'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 在 staging 跑 Playwright）

- [ ] [BEHAVIOR:E2E] 客户完整走完 Golden Path（staging Playwright，截图可视化验证）
  Screenshots:
    - staging-preview.png    期望：PickStep 素材卡片渲染出 <video> 元素且实际发出 signedUrl 请求
    - staging-candidates.png 期望：候选缩略图拼贴虚拟滚动，DOM 节点数与可视区一致（非 200+ 全量渲染）
    - staging-render.png     期望：选中候选后出现「排队第 N 位 / 渲染中 / 渲染失败可重试」态
  路径格式：${SPRINT_DIR}/screenshots/staging-<step>.png
  期望：所有截图与期望描述一致，Claude Read 图自验通过
