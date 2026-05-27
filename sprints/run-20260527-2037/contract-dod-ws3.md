---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Agent ffprobe width/height + detectedAspect + 单文件输出

**范围**: `video-pipeline.ts` Step 1 补读 `width`/`height`；rotation=90°/270° 时 swap；计算 `detectedAspect`（"9:16"/"16:9"）；PATCH `detected_aspect` 写回 DB；计算 `effectiveTarget = target_aspect ?? detectedAspect ?? "9:16"`；非模板路径按 effectiveTarget 只生成单个文件
**大小**: M（~110 行净增/改，1 文件）
**依赖**: Workstream 2 完成后（线性串行链；WS3 的 Agent 逻辑与 WS2 的 composeTemplate 同属视频处理链路，串行确保 evaluator 不并发 dispatch）

> **WS3 BEHAVIOR oracle 说明**:
> Agent（Node.js Windows 进程）的 ffprobe 行为无法通过本地 HTTP API 直接测试（需要真实视频文件 + ffprobe 二进制 + Agent 运行）。
> WS3 采用「源码逻辑断言」策略验证实现完整性；Agent 真实行为在 Final E2E（agent-e2e-video.yml，GHA windows-latest）验收。
> 源码断言通过定位具体行号范围而非全文 includes()，避免函数名出现在注释中导致假阳性。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `video-pipeline.ts` 含 `detectedAspect` 变量声明
  Test: bash -c 'grep -q "detectedAspect" services/agent/src/handlers/video-pipeline.ts && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `video-pipeline.ts` 含 `effectiveTarget` 变量声明
  Test: bash -c 'grep -q "effectiveTarget" services/agent/src/handlers/video-pipeline.ts && echo OK || { echo FAIL; exit 1; }'

- [ ] [ARTIFACT] `video-pipeline.ts` 含 PATCH `detected_aspect` 调用（写回 DB）
  Test: bash -c 'grep -q "detected_aspect" services/agent/src/handlers/video-pipeline.ts && echo OK || { echo FAIL; exit 1; }'

---

## BEHAVIOR 条目（源码逻辑断言 — Agent 内部无 HTTP 端点可测）

- [ ] [BEHAVIOR] ffprobe Step 1 从 video_stream 读取 `.width` 和 `.height` 字段（Step 1 范围内）
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; STEP1_LINE=$(grep -n "Step 1" "$F" | head -1 | cut -d: -f1); END_LINE=$(grep -n "Step 2" "$F" | head -1 | cut -d: -f1); [ -n "$STEP1_LINE" ] && [ -n "$END_LINE" ] || { echo "FAIL: 找不到 Step 1 / Step 2 标记"; exit 1; }; CHUNK=$(sed -n "${STEP1_LINE},${END_LINE}p" "$F"); echo "$CHUNK" | grep -q "\.width" || { echo "FAIL: Step 1 未读 .width"; exit 1; }; echo "$CHUNK" | grep -q "\.height" || { echo "FAIL: Step 1 未读 .height"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] rotation=90°/270° 时 effectiveWidth = 原始 height（swap 逻辑存在）
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; grep -q "effectiveWidth" "$F" || { echo "FAIL: 缺 effectiveWidth"; exit 1; }; grep -q "effectiveHeight" "$F" || { echo "FAIL: 缺 effectiveHeight"; exit 1; }; grep -qE "=== 90|=== 270|== 90|== 270" "$F" || { echo "FAIL: 缺 rotation 90/270 判断"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] detectedAspect 计算：effectiveWidth < effectiveHeight → "9:16"（判断逻辑存在）
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; grep -q "detectedAspect" "$F" || { echo "FAIL: 缺 detectedAspect"; exit 1; }; grep -q "9:16" "$F" || { echo "FAIL: 缺字符串 9:16"; exit 1; }; grep -qE "effectiveWidth.+effectiveHeight|effectiveHeight.+effectiveWidth" "$F" || { echo "FAIL: 缺 effectiveWidth/Height 比较逻辑"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] effectiveTarget 优先级：target_aspect（job 字段）> detectedAspect > "9:16" fallback
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; grep -q "effectiveTarget" "$F" || { echo "FAIL: 缺 effectiveTarget"; exit 1; }; grep -qE "target_aspect.+\?\?|target_aspect.+\|\|" "$F" || { echo "FAIL: 缺 target_aspect null-coalescing 优先级"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] detected_aspect 通过 HTTP PATCH 写回 API（progress endpoint 或专属 endpoint）
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; grep -q "detected_aspect" "$F" || { echo "FAIL: 缺 detected_aspect"; exit 1; }; grep -qE "fetch|PATCH|progress" "$F" || { echo "FAIL: 缺 HTTP 写回调用"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非模板路径只生成单个文件 + effectiveTarget 变量存在（双重验证防假绿）
  Test: manual:bash -c 'F="services/agent/src/handlers/video-pipeline.ts"; grep -q "effectiveTarget" "$F" || { echo "FAIL: 缺 effectiveTarget（WS3 未实现）"; exit 1; }; TOTAL=$(grep -c "copyFileSync" "$F" 2>/dev/null || echo 0); [ "$TOTAL" -le 1 ] || { echo "FAIL: 全文 copyFileSync 次数=$TOTAL（期望 ≤ 1，双文件输出仍存在）"; exit 1; }; echo "OK: effectiveTarget 存在，copyFileSync 次数=$TOTAL"'
  期望: OK: effectiveTarget 存在，copyFileSync 次数=0 或 1
