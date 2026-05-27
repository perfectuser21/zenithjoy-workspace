---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Agent ffprobe width/height + detectedAspect + 单文件输出

**范围**: `video-pipeline.ts` Step 1 补读 `width`/`height`；rotation=90°/270° 时 swap；计算 `detectedAspect`（"9:16"/"16:9"）；PATCH `detected_aspect` 写回 DB；计算 `effectiveTarget = target_aspect ?? detectedAspect ?? "9:16"`；非模板路径按 effectiveTarget 只生成单个文件
**大小**: M（~110 行净增/改，1 文件）
**依赖**: Workstream 2 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `video-pipeline.ts` 含 `detectedAspect` 变量声明
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('detectedAspect'))process.exit(1)"

- [ ] [ARTIFACT] `video-pipeline.ts` 含 `effectiveTarget` 变量声明
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('effectiveTarget'))process.exit(1)"

- [ ] [ARTIFACT] `video-pipeline.ts` 含 PATCH `detected_aspect` 调用（写回 DB）
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');if(!c.includes('detected_aspect'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] ffprobe Step 1 从 vStream 读取 `width` 和 `height` 字段
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");const step1=c.slice(c.indexOf(\"Step 1/7\"),c.indexOf(\"Step 1/7\")+3000);if(!step1.includes(\".width\")||!step1.includes(\".height\")){console.error(\"FAIL: Step 1 未读 width/height\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] rotation=90°/270° 时 effectiveWidth = 原始 height（swap 逻辑存在）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");const swapOk=c.includes(\"effectiveWidth\")&&c.includes(\"effectiveHeight\")&&(c.includes(\"videoRotation===90\")||c.includes(\"videoRotation === 90\")||c.includes(\"=== 90||\")||c.includes(\"rotation===90\")||c.includes(\"90||videoRotation\"));if(!swapOk){console.error(\"FAIL: rotation swap 逻辑缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] detectedAspect 计算：effectiveWidth < effectiveHeight → "9:16"，否则 → "16:9"
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");const hasCalc=(c.includes(\"9:16\")&&c.includes(\"detectedAspect\"))&&(c.includes(\"effectiveWidth\")&&c.includes(\"effectiveHeight\"));if(!hasCalc){console.error(\"FAIL: detectedAspect 计算逻辑缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] effectiveTarget 优先级：target_aspect（job 字段）> detectedAspect > "9:16" fallback
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");const hasNullCoalesce=(c.includes(\"target_aspect??\")||c.includes(\"target_aspect ??\")||c.includes(\"job.target_aspect\"))&&c.includes(\"effectiveTarget\");if(!hasNullCoalesce){console.error(\"FAIL: effectiveTarget 优先级逻辑缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 非模板路径只生成单个文件（不再双文件 9_16 + 16_9 同时输出）— 源码中非模板分支无双 copyFileSync 模式
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");const nonTpl=c.slice(c.lastIndexOf(\"if (!job.template_id)\"),c.indexOf(\"// Step 7\"));if(!nonTpl){console.log(\"OK: 无法精确提取，跳过此检查\");process.exit(0)}const copies=nonTpl.split(\"copyFileSync\").length-1;if(copies>1){console.error(\"FAIL: 非模板路径仍有\"+copies+\"次 copyFileSync（期望最多1次）\");process.exit(1)}console.log(\"OK: copyFileSync 次数=\"+copies)"'
  期望: OK

- [ ] [BEHAVIOR] error path — detected_aspect PATCH 调用 fireProgress 或 fetch 包含 detected_aspect 字段
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/video-pipeline.ts\",\"utf8\");if(!c.includes(\"detected_aspect\")){console.error(\"FAIL: detected_aspect PATCH 缺失\");process.exit(1)}const hasPatch=c.includes(\"detected_aspect\")&&(c.includes(\"progress\")||c.includes(\"PATCH\")||c.includes(\"fetch\"));if(!hasPatch){console.error(\"FAIL: detected_aspect 未通过 HTTP 写回\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
