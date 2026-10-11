# 101搜索视口回退后离屏候选的有界恢复

GP-Anchor: line02/keyword_acquisition keep-green
根任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7。真实SID：01a11b40-46cc-7a52-8c79-01b58f4583a6。
基线：26216c2599ae5be1939a5195c8685b47dfe21fa4。根代理已登记离线修复事件并授权自有隔离树，本阶段不发布。

## 问题与证据

真实codex10110735_ai30s5_101的候选14/23/24/27/28，初树卡片完整，但前一视频分享归位后共同卡下移698/852/532px。原标题及作者在三次fresh树均整卡离屏，不是时长/点赞/日期匹配变化。现有归位只验关键词/视频tab，未验视口连续性；底部裁切提示要求标题还可见，无法处理完整离屏。

真实最小fixture保留dlr卡片和keyword/tab、原坐标/标题作者/时长/点赞/日期；原树与投影fixture SHA256及转换写fixtures/viewport-restore/provenance.json。日志/tmp/codex-viewport-restore-business-valid-red-20261011.log 5例均0!=1，合法RED commit78154dd3。209a6689曾存在测试语法错误，不作业务RED证明，历史保留。

## 最小实现与判定点

| 判定点 | 依据 | 行为／失败处理 |
|---|---|---|
| 原候选 | 本run同目录完整树，唯一title/author/duration，真实desc/dlr/q9g/like/date同列 | 缺失、别run、symlink拒绝 |
| 导航距离 | 新旧树相同keyword+selected视频tab+严格Douyin包；至少1完整唯一共同卡title/author/duration/点赞文案/日期均一致；各锚x不变、全部y统一偏移±2px | 元数据或相对几何变化拒绝；一锚只作导航提示，不宣称连续性 |
| 原卡确实离屏 | fresh不存在原卡标题，原完整title顶边加偏移已≥屏高 | 屏内标题仍可见拒绝此分支，由既有裁切逻辑处理 |
| 恢复手势 | 正偏移80..40%屏高，仅一次restore-offset上滑，500ms，非零ADB失败 | 不重试手势，不提升预算，预算前后检查 |
| 实际点击 | 总计原3读内fresh完整唯一title/author/duration，原like几何解析仍在 | 旧坐标永不点击；歧义目标禁止通过追加ordinal候选绕过；新其它槽仍枚举真实VID |
| 采集不完整 | 有界导航仍未恢复 | candidate_viewport_unrestored保留partial，即便其它链接达到数量；wrapper不放宽 |

所有恢复回执带navigation_only=true、continuity_verified=false、anchor_count/offset/source/fresh evidence；verified仅指目标最终完整定位成功。三共锚14与一共锚23/24/27/28都不是实际VID证明。实际VID仍由原nonce三阶段、分享复制、可信解析、PG入库判断；不按标题作者提前去重。没有新Activity/外部合同/Commander边界。

## 测试与验收

- 5真实最小XML经过真实video_cards_from_xml、真实纯hint和真实discovery handler，fake手机手势后从已有完整树恢复；全部取新树坐标，5/5业务RED→GREEN。
- 负例：错keyword/tab/package、缺like/date、like/date变化、非统一位移、超幅、重复完整共锚、坏XML、别run、symlink、预算前后、gesture失败、恢复仍缺候选、fresh双同身份。
- 原card-bottom-reveal/streaming-discovery回归，保留同标题不同VID与新完整B枚举；新增测试接正式leadgen-split-smoke，不复用旧结果宣称本源全部验收。
- 当前只证明离线组件行为；像素手势与实际滚动量关系、App返回视口机制仍需部署后新批真实验收。当前26216c25批次保持冻结。
