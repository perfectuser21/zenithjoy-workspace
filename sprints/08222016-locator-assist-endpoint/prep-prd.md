# 小改动 PrepPRD：刀2a 定位求助端点（AI on-call 横切件第二刀·中台段）

## 归属
line02 横切件「AI on-call 定位求助」刀2 第一段（中台侧）。安卓端接线为刀2b 另行。
锚：`line02/keyword_acquisition keep-green`。主理人 0822 拍板要点：每步通用保底协议、
机型×版本缓存键、双后端插座（树→TOAPIS 主力 / 截图→UI-TARS 兜底，插座先定义后通电）。

## 改什么
**migration `rpa_locator_assist` 表**（出诊病历 + 中台缓存一张表两用）：
step/target_desc/device_model/os_version/douyin_version/app_version/error_code/
ui_tree_snapshot/backend/model/answer_line/answer_selector(jsonb)/verified(留列刀2b回填)/
cache_hit/created_at；缓存键索引 (step, target_desc, device_model, os_version, douyin_version)

**新 service `locator-assist.ts`**：
- `LocatorBackend` 接口 + `TreeLlmBackend`（deepseek-v4-flash via TOAPIS，纯文本任务不需要
  视觉模型；`reasoning_effort:'none'` 关思考 + max_tokens 300 + finish_reason=length 截断守卫
  ——全部沿用 content-judgment/comment-grading 已踩实的教训）+ `VisionUiTarsBackend` 占位
  （读 UITARS_BASE_URL/UITARS_API_KEY，未配置 throw NOT_CONFIGURED，路由降级）
- prompt：目标描述 + 步骤上下文 + 树全文（每行有 d{深度} 前缀天然可引用行号），要求模型只回
  一行 JSON `{"line": N}`；解析后从树第 N 行提取 view_id/text/desc/bounds 组装候选返回
- **fail-open 语义**：模型超时/解析失败/行号越界 → 返回 `assist:'unavailable'`，安卓端走原
  失败路径，绝不因求助通道故障阻塞 RPA 主流程

**路由 `POST /api/agent/burner/locator-assist`**（agent-burner router，同款 per-agent 限流）：
必填 step/target_desc/ui_tree_snapshot（64KB 服务端截断）；先查缓存（同缓存键最新一条
verified IS NOT FALSE），命中直接回不调模型；miss 调 backend；无论成败落病历行

**env-registry**：OPTIONAL_ENV 登记 LOCATOR_ASSIST_MODEL / UITARS_BASE_URL / UITARS_API_KEY

## 为什么改
碎片化矩阵（机型×安卓版本×抖音版本）的 UI 漂移类失败，代码枚举不完，AI 看一眼树就能裁决。
刀1 病历已在生产攒树快照（0822 真机实证 5148 字符含抖音 resource-id），本刀让病历变成答案。

## 影响范围
- 纯新增（新表/新 service/新路由），既有 RPA 链路零改动——安卓端未接线前本端点无人调用
- 复用 TOAPIS 通道与全部截断/关思考教训（toapis_max_tokens_includes_reasoning）

## 验收标准
- [ ] commit-1 失败测试先行：prompt 含树与目标 / 行号解析（合法/越界/非JSON/截断守卫）/
      缓存命中不调模型 / vision 未配置降级 / fail-open / 病历落库
- [ ] commit-2 实现转绿 + tsc + 既有测试无回归
- [ ] smoke：本地 mock TOAPIS 起真 API+真库端到端（首问打模型、二问命中缓存不打模型、病历两行）
- [ ] env-gate 测试绿（新 env 已登记）
