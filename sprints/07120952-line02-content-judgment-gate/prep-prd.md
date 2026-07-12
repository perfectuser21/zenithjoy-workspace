# PrepPRD：客户智能获客路径（Line02安卓端）— 新增视频/图文内容判定门槛 + 留言触达门槛化

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：视频文案判定（图文OCR+视频转写，统一走ToAPIs Gemini多模态）+ 留言判定门槛化 + 触达门槛化
- [ ] 另立 Sprint（本次不做）：打字方式改逐字模拟（反风控加固）
- [ ] 待讨论：ToAPis Gemini具体单价（成本预估待上线后实测校准）

## Journey 当前状态
- ✅ 客户智能获客采集闭环（飞书文档画像→扩词→搜视频→抓评论者）— thin/working
- ✅ Step 6 评论区挖客闭环（抓评论→回评+私信带企微号→企微webhook→AI首答→飞书Lead）— thin/working
- ✅ 抖音私信主动触达 — medium/working
- ➕ 视频/图文内容判定门槛（新增，本次范围）
- ➕ 留言触达门槛化（在 Step 6 评论区挖客闭环基础上加厚）

## 本次要做的
安卓Agent采集抖音视频后，不再只按标题简单扩词抓取，而是真正"看完"内容再决定要不要挖这条视频下的评论：图文帖截图OCR取文字，视频帖录音转写取文字稿，交给AI判定是否匹配目标客户画像，只有判定通过（matched）的视频才继续抓评论。同时评论区线索的"能不能私信触达"从"只影响排序"改成"硬门槛"——分数不够格的线索客服在CRM里能看到，但系统不会自动私信。

## Golden Path（用户操作流程）

1. 客户在Dashboard填"目标画像描述" → 存 `acquisition_config.target_profile_desc`（租户级）
2. 安卓Agent关键词搜视频→逐个点开卡片：图文帖→截图→OCR取文字；视频帖→录音→转写取文字稿（OCR+转写统一调用ToAPIs Gemini多模态模型，base URL `https://toapis.com/v1`，OpenAI兼容格式）
   - 2-失败：录音/截图失败（如MediaProjection授权弹窗被拒/超时）→ 该视频标记`skipped_capture_failed`，按默认拒绝处理，不阻塞其余视频采集
3. 转写/OCR文本 + 画像描述 → 异步调用同一Gemini模型做语义判定 → matched/rejected/pending
   - 3-失败：判定超时(8秒)或API调用失败 → 保持pending状态重试，超阈值告警
4. 只有matched视频生成Stage2任务→抓该视频下评论（rejected/pending不抓，但记录留存供人工复核）
5. 评论打4档标签(现状不变，`comment-grader.ts`)→线索汇总分(`rescoreLead`)
6. 线索分数达到门槛(初始定"精准"档，上线后按真实分布数据复核调整)→`outreach_eligible=true`→进候选池；不达标线索CRM可见但系统不触达
7. 生成`dm_assignments`时校验`outreach_eligible`（而非仅在发送前校验一次）→触发私信触达；生成后到实际发送前若分数被重算拉低→标记`cancelled`，不发送

## 客户视角
客户会发现：私信触达的对象更"精准"了（不再是随便什么标题沾边的视频下面都挖），CRM里能看到被判定为"内容不相关"或"暂未判定"的线索留痕，不会被系统自动私信打扰，但客户/客服仍可手动跟进。

## 完成后用户能
- 系统只对真正匹配画像的视频内容挖评论，减少无效触达
- 客服在CRM里能看清每条线索"是否达到触达门槛"，而非全量按分数排序模糊处理
- 内容判定失败/待定的视频有留痕，不会被静默丢弃

## 涉及的 Ability / Feature
- 客户智能获客采集闭环（thin→medium，加厚：新增真实内容判定环节替代原"抓到即挖评论"简化逻辑）
- Step 6 评论区挖客闭环（thin→medium，加厚：触达从排序参考升级为硬门槛）

## 不包含
- 打字方式改逐字模拟输入（反风控加固，另立sprint）
- 服务端下载视频文件做判定（采集在设备端本地完成，不下载视频文件）
- 新增腾讯云OCR等额外依赖（复用ToAPIs Gemini多模态能力）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 视频文案是否与目标画像相关 | 关键词匹配 / AI语义判定 / 两阶段 | AI语义判定，统一调用ToAPIs Gemini多模态模型 | 抖音标题党多，纯关键词匹配不够准；Gemini多模态可一次调用完成OCR/转写/判定，比原Whisper+OpenRouter方案成本更低 | 误判"相关"浪费采集/判定资源；误判"不相关"丢失真实线索 |
| 无法采集内容（截图/录音失败）时默认放行还是拒绝 | 放行 / 拒绝 | 默认拒绝 + 租户白名单例外 | 默认放行会让判定门槛形同虚设 | 默认拒绝可能漏掉个别优质视频，可通过租户白名单兜底 |
| 留言判定门槛档位 | 精准档 / 高意向档 / 连续分数阈值 | 先"精准"档上线观察，按真实分布数据复核调整 | 上线前没有真实分布数据支撑，不能拍死具体阈值 | 阈值过高导致触达量暴跌；阈值过低导致门槛形同虚设 |
| 触达资格重算时机 | 实时同步 / 定时批量 | 复用现有`rescoreLead`触发时机做增量重算 + 配置变更时异步全量重算 | 避免脏数据（阈值改了历史线索资格没跟着变） | 计算滞后可能错失触达时间窗口 |
| AI/采集失败时的降级策略 | fail-open / fail-closed / pending重试 | pending重试 + 超时告警，不做自动兜底判定 | fail-open/fail-closed本质都是把"不确定"伪装成确定结果，会掩盖真实故障 | 静默瘫痪判定链路而不自知 |

## 前置工作（已逐项确认）

### 账号与登录
- [x] 抖音测试小号 — 已就绪（复用现有Line02测试账号体系）

### API 与凭据
- [x] TOAPIS_API_KEY — 已在 `~/.credentials/toapis.env`，1Password CS Vault条目"ToAPIs"

### E2E 测试账号
- [x] 复用现有Line02客户智能获客E2E测试租户

### 测试 Fixture
- [x] 图文帖/视频帖测试素材 — 复用现有采集链路已跑通的真机测试视频（`handoff_0711_collect_singleflight_shipped_real_videoid.md`中真实video_id）

### 基础设施
- [x] 安卓Agent无障碍服务`takeScreenshot()`截图能力 — 已具备
- [x] 安卓Agent录音能力（MediaProjection+RECORD_AUDIO）— **本次新增，sprint内第一件事是真机验证spike**：验证MediaProjection录音授权弹窗是一次性授权还是每视频弹一次，直接决定无人值守体验能否达标

## 技术前提/风险
- MediaProjection录音授权弹窗行为需真机验证（一次性授权还是每视频弹一次）— sprint内第一件事就是做这个技术验证spike，不是先验证完再立项
- 截图用无障碍服务自带`takeScreenshot()`能力，OCR/转写/判定统一复用ToAPIs Gemini多模态模型（不新增腾讯云OCR等依赖）

## 成本预估
满载(100租户)预估月增判定+OCR+转写费用，具体单价待ToAPIs定价页确认后校准（初步预期低于原Whisper+OpenRouter方案，因统一走Gemini多模态且ToAPIs定价更低）；评论门槛化本身不增加成本（复用现有`comment-grader.ts`/`rescoreLead`调用）。

## 验收标准（Final E2E）
- [ ] 真机验证：MediaProjection录音授权弹窗行为已确认（一次性/每次弹），并据此确定是否需要额外无人值守兜底方案
- [ ] 真机跑通：图文帖截图→OCR取文字→判定matched/rejected 全链路，DB中`acquisition_collect_videos`表判定结果字段正确落库
- [ ] 真机跑通：视频帖录音→转写取文字稿→判定matched/rejected 全链路，DB中判定结果字段正确落库
- [ ] rejected/pending视频不生成Stage2抓评论任务，matched视频正常生成
- [ ] 线索分数低于门槛的`outreach_eligible=false`，`dm_assignments`生成时校验拦截，不触发私信
- [ ] CI 全绿
