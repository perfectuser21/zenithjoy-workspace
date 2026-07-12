# PrepPRD：客户智能获客路径（Line02）— 内容判定门槛客户端接线

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：Android Agent 端真实截图捕获 + judge-video 接线，使 judgment_status 能从 pending 流转
- [ ] 另立 Sprint（本次不做）：pending 视频重试机制、抖音窗口区域裁剪截图、其余泄露密钥整改
- [ ] 待讨论：无（三个判断点已由用户拍板，前置工作已核对完成）

## Journey 当前状态
- ✅ `/judge-video` 判定 API（服务端，Gemini 多模态判定）— done
- ✅ Stage2 派发过滤 `judgment_status != 'rejected'`（PR#1243）— done
- ✅ staging DB 迁移 `20260712_content_judgment_gate.sql`（judgment_status/judgment_reason/capture_type/target_profile_desc/outreach_eligible）— **已在 mmv/zenithjoy_test 执行验证，全字段齐全**
- 🔄 视频/图文内容判定门槛+留言触达门槛化（journey_feature `2a23912e-cfbe-41a7-adc6-81167818ec43`）— status=planned，服务端 done，客户端未接线（本次目标：thin 落地）
- ⬜ Android `ContentJudgmentService.kt` 真实截图捕获 — 未实现（本次做）

## 本次要做的
让 Android Agent 在真实采集流程中真正调用 `/judge-video`：截图捕获 MediaProjection 一次性授权、压缩 base64、传给已有的 `ContentJudgmentService.judge()`，并在 `AgentService.kt` 里正确接线 `AcquisitionCollectPollLoop`，使 `judgment_status` 能从永久默认值 `pending` 流转为 `matched`/`rejected`，让判定门槛在生产链路真正生效。

## Golden Path（用户操作流程）

1. 客户在 Android 设备首次触发内容判定采集 → 系统弹出"屏幕录制"系统授权对话框（经由 MainActivity 透明中转获取 token）→ 客户点击"立即开始" → Agent 在 foreground service 内缓存 MediaProjection 实例，注册 `Callback.onStop()` 监听
2. Agent 在 Stage1 采集流程中定位到一张视频/图文卡片 → 串行（单飞锁）调用截图：`VirtualDisplay`+`ImageReader` 捕获当前屏幕帧 → 立即 `image.close()` 释放资源 → 压缩为 JPEG(70%,720p) → base64 编码
3. Agent 调用 `POST /api/acquisition/judge-video`（capture_type=screenshot, dataB64=真实数据）→ 服务端调用 Gemini 判定 → 返回 `judgment_status`
4. `judgment_status=matched` → 视频照常进入 Stage2 抓评论；`rejected` → Stage2 派发查询已排除（PR#1243）；因超时/异常变 `pending` → 不阻塞，登记 `skipped_capture_failed`（若截图失败）
5. 客户在 Dashboard 能看到"已判定 matched/rejected/pending"的真实分布，判定门槛在生产链路生效

**首次 vs 日常**：首次弹一次系统授权框；MediaProjection 实例失效（息屏/进程被杀/onStop 回调触发）后自动降级为"需重新授权"状态，下次采集时重新弹一次，不重复弹。

**出错恢复**：
- 客户拒绝截图授权 → 该设备本次会话内所有视频判定跳过，`judgment_status` 保持 `pending`（永久跳过策略，已拍板），不重试，不阻塞 Stage2（当前排除法只挡 rejected）
- 截图/网络失败或返回全黑图（DRM/SECURE flag/国内 ROM 静默拦截）→ 标记 `capture_type=skipped_capture_failed`，DB 留痕不静默丢弃，不重试

## 客户视角
客户不会看到新的操作界面变化，唯一可感知的差异：首次使用时会多弹一次"屏幕录制"系统授权框（点一下即可，后续不再弹）；Dashboard 上原本一直空转的"内容判定"统计（matched/rejected/pending 分布）会开始出现真实数据。

## 完成后用户能
1. 在 Dashboard 看到真实的内容判定分布（而非全部停留在 pending 的假数据）
2. 与目标客户画像不符的视频（rejected）不再进入 Stage2 抓评论浪费额度
3. 首次使用 Agent 时一次性完成截图授权，无需反复操作

## 涉及的 Ability / Feature
- 视频/图文内容判定门槛+留言触达门槛化（`2a23912e-cfbe-41a7-adc6-81167818ec43`，planned → thin）

## 不包含
- pending 视频的重试/回捞机制（留到 thicken 阶段）
- 抖音窗口区域裁剪截图（本次用整屏截图，已拍板）
- 其余泄露密钥整改（安全整改范围决策仍待用户拍板，独立于本次）
- 留言触达门槛化的 outreach_eligible 逻辑（服务端 rescoreLead 已实现，属已完成范围，本次不改）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 截图捕获范围 | 整屏截图 / 仅抖音窗口裁剪 | 整屏截图 | 用户拍板：简单可靠，MediaProjection 原生能力 | 可能截到通知栏等无关内容，但仅用于判定不落盘不外传，风险可控 |
| 截图内容有效性判定 | 直接使用 / 先校验非全黑非全零再用 | 先校验非全黑非全零 | 混沌工程师审查发现：DRM/SECURE flag/部分国内 ROM 会静默返回黑屏，不抛异常 | 若不校验，无效截图会被当作有效判定送 Gemini，产生误判且不可追溯 |
| 授权拒绝后策略 | 永久跳过仅登记 / 每轮重新提示 | 永久跳过仅登记 | 用户拍板：避免反复弹窗打扰客户 | 该设备判定门槛长期不生效，需 Dashboard 人工发现并二次授权（非自动恢复） |
| pending 视频重试 | 本次登记不重试 / 加定时重试 | 本次登记不重试 | 用户拍板：thin 阶段先落地主链路，重试机制留 thicken | pending 视频永久停留，不重新判定，但不阻塞 Stage2（可接受） |

## 已命中的铁律（自动 enforce）
- 租户隔离（judge-video 调用需带 tenant_id，服务端已 enforce）
- 日志脱敏（截图 base64 不应完整打印进日志）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] xian-rog 真机 SSH 可达（已验证 `ssh xian-rog` 连通）

### API 与凭据
- [x] `/judge-video` 依赖的 Gemini 凭据 — 服务端已配置且已工作（judge-video 现有实现已可正常调用，本次不新增凭据）

### 数据库
- [x] staging（mmv / `zenithjoy_test`）已执行迁移 `20260712_content_judgment_gate.sql`：`judgment_status`/`judgment_reason`/`capture_type`/`target_profile_desc`/`outreach_eligible` 全字段+索引齐全（本次核对时验证，此前记录"未部署"的结论是把本地 dev 库 `cecelia` 误当成 staging）

### 基础设施
- [x] Android Agent CI 已就绪：`.github/workflows/android-agent-ci.yml`
- [x] MainActivity 存在（`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/MainActivity.kt`），可用于 MediaProjection 授权结果透明中转
- [x] `targetSdk=34` 已确认（Android 14），manifest 现有 `foregroundServiceType="dataSync"`，本次实现需补充声明 `mediaProjection` 类型（Android 14 强制要求，否则 `startForeground` 抛 `MissingForegroundServiceTypeException`）——已纳入实现范围，非阻塞

## 验收标准（Final E2E）
- [ ] xian-rog 真机：首次触发采集 → 系统弹出屏幕录制授权对话框 → 授权后 Agent 缓存 MediaProjection 实例，日志确认无重复弹窗
- [ ] xian-rog 真机：采集到视频卡片后，`ContentJudgmentService` 发出的 `POST /judge-video` 请求体 `dataB64` 非空且可解码为合法 JPEG（非硬编码空字符串）
- [ ] staging DB 查询：真机采集轮次结束后，`zenithjoy.acquisition_collect_videos.judgment_status` 出现非 `pending` 的真实值（`matched`/`rejected`），关联 `judgment_reason` 非空
- [ ] rejected 视频未出现在对应 Stage2 `dm_assignments`/评论抓取任务中（复用 PR#1243 排除逻辑验证）
- [ ] 拒绝截图授权场景：模拟拒绝后，后续该设备判定请求不再弹窗，`judgment_status` 停留 `pending` 且不阻塞 Stage2 派发
- [ ] Android CI（`android-agent-ci.yml`）全绿，含新增单测覆盖 dataB64 非空断言 + MediaProjection callback 生命周期处理
- [ ] CI 全绿
