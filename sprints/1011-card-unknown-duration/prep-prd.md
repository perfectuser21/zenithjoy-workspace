# 未知时长的双树强锚补充

GP-Anchor: line02/keyword_acquisition keep-green
任务：713e4691-6fb1-444c-9e1a-bd5a8cea28b7；SID：01a11b40-46cc-7a52-8c79-01b58f4583a6
基线：2177e9d3；自有隔离树，不改根冻结源、不设备、不发布。

真实candidate22原树作者Neo小海/点赞“未点赞，喜欢2.4万，按钮”/日期03.13同列完整而时长空；三次新树同强锚但露出00:47。Video输出合同无duration；控制器可选duration读不到时为''，以未知当固定值导致假消失。此修复是101 collect_videos内部helper，不新增Activity或外部输入。

仅原duration空且原/fresh唯一title+author才执行实际两树判定。两树严格完整XML/全Douyin包/desc→clickable dlr、作者及like几何同列、like完整状态数字文案精确一致、可见日期一致、列x一致；原文件同run src证据与新文件同run candidate loc证据、同目录、拒symlink。原确无duration，新完整thumbnail+唯一duration时才补齐；之后按补充后的完整identity唯一匹配点新树坐标，真实VID仍由原取链校验。非空原时长、多重身份、原证据缺失/别run、like/日期/结构变化、错误keyword/tab均不放宽。保留双树证据及补充字段事实。

沿用三定位/每候选一次短滑及预算/数量，双树helper不追加手机动作。此前裁切B逻辑视口新槽均取真实VID、bounded fingerprints保持。守卫：card-bottom-reveal.test.mjs；真实纯helper RED043aa581、真实handler RED4802e8af→GREEN。root统一最终full/live另验，不能将本地PASS写成已上线。
