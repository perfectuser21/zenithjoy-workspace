# Handoff：AI on-call 定位求助横切件 —— 全量落地（0822晚→0823凌晨）

**格子坐标**：line02 · 横切件池 · 新建横切件（0822 主理人拍板）
**verdict**：PASS（树可见的定位类+读取类全覆盖并真机总装验过；仅 Lynx 失明的视觉后端待通电）

## 靶子（主理人口径）
机型×安卓版本×抖音版本碎片化导致的 RPA 不准/不稳。**每一步都要有 AI 保底**，
除了最后一桩：风控/封号/无障碍被撤/断网/手机掉线（→就绪度上报，人处理）。

## 已交付（7 个 PR）
| PR | 刀 | 内容 |
|---|---|---|
| #1700 | 刀1 | 失败现场落无障碍树快照+设备版本三件套(dm_outreach_log)，30天保留期 |
| #1702 | 刀2a | locator-assist 端点：树→deepseek 指认候选+缓存(机型×版本格子键)+UI-TARS插座+fail-open |
| #1703 | 刀2b | 安卓接线：搜索入口/输入框判死前问保底→验证闸→verified三态回执 |
| #1705 | 刀A | extract 模式：AI 从主页树抽抖音号(救 26/35 缺号死线索)+格式验证闸 |
| #1706 | 刀C | 私信链定位类全覆盖：私信入口/消息框/发送 三判死点挂保底 |
| #1707 | 刀C2 | 采集链评论按钮挂保底(线索供给咽喉) |

## 覆盖矩阵（43 动作点）
- **定位类 22**：私信链全覆盖(D2/D3/D13/D14/D16)+采集评论按钮(C13)已挂；采集搜索链(C3/C4/C6/C8)剩，同模式待铺
- **读取类 5**：C17 读抖音号已挂 extract；C15评论抽取/S7账号列表/C11剪贴板 待铺
- **匹配/语义 2**：判定链本就是AI；D10身份核验+D8结果行盲点=NO_MATCH根子，**需视觉后端**
- **确认类 9**：验证闸骨架在，AI复核未挂
- **除外**：风控/封号/授权撤/断网/掉线(主理人拍板)

## 真机总装（荣耀X30 2.1.40，0823凌晨）
- 全套保底接线装上，主流程正常跑通无退化(假号→NO_MATCH身份核验正确拒发，没误发)
- 0822晚受控实验已证：真实TARGET_ABSENT→自动出诊→deepseek真调→AI诚实答无→fail-open判死(负例闭环)

## 唯一未通电：视觉后端(UI-TARS) + 3处 Lynx 失明
**D8"坐标盲点点结果第一行"是 NO_MATCH 的真根子**——结果列表 Lynx 渲染不进树，
树/文本双废，只有截图+视觉能救。UI-TARS 插座已在中台留好(env UITARS_BASE_URL/KEY)，
火山方舟 Ark key 已在 1Password。**未通电的原因是它需要设备端截图能力**——
MediaProjection 是会话级(每次升级重点)、AccessibilityService.takeScreenshot 需
无障碍配置加 canTakeScreenshot(有碰掉全机队授权的风险)。这块**必须单台机验证再推**，
不在凌晨赌。这是"最后一桩"之外唯一剩的工程，独立立项(见下 next_steps)。

## next_steps
1. **视觉后端刀**(治 NO_MATCH，今天失败主体)：中台 vision 后端接火山 UI-TARS(截图→坐标/选择)
   + 设备端截图能力(先单台机验 canTakeScreenshot 不碰授权) + D8/D10 接线。独立立项、真机先行。
2. 采集搜索链剩余定位点(C3/C4/C6/C8)批量铺(同刀C模式，机械活)
3. 读取类剩余(C15/S7)铺 extract
4. **刀3 周报固化**：rpa_locator_assist 病历按机型×版本×步骤聚类，AI稳定答案写进定位器发版，
   agent 端缓存作废，AI出场随发版递减
5. 并行高优(非本横切件)：dm_assignments 唯一约束与重投语义冲突 P1

## 数据源
zenithjoy.rpa_locator_assist(出诊病历+缓存,含 mode 列) / dm_outreach_log 现场四列 /
apps/api/src/services/locator-assist.ts / services/agent-android/.../uia/{UiTreeSnapshot,LocatorAssistClient}.kt /
决策 d8da2a85/c8c7ba30/c8c7ba30；火山Ark key=1Password "Volcengine Ark (火山方舟LLM)"
