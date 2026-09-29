# Handoff：作战窗展开态补收起按钮（用户真机实测发现卡住出不来）

**Verdict**: PASS
**Branch**: cp-07291038-panel-collapse-button

## 完成
- 用户在xian-rog真机上直接操作反馈"召唤不出来"/"双击之后就没了"，排查确认：ExpandedPanel.tsx通篇零点击处理器，收起唯一方式是热键(⌃⌥Z)/托盘
- 用真实keybd_event模拟验证热键机制本身工作正常（展开[1707x1019]→按热键→收起[8x959]），排除"热重启没弄好"的怀疑
- 确认"Python安装包"疑云 = 早于本sprint存在的line04画像卡(AI客服助手)独立弹窗，与作战窗无关，未受影响
- 确认画像卡窗口重叠是刀3已排期范围，本次不提前处理（已征求用户意见并确认）
- 新增panel-collapse-button（固定右上角，始终可见），TDD 4用例先红后绿，vitest 12文件75用例全绿
- PR #1524已合并（GP-Anchor: line04/customer_private_ai keep-green）

## 没完成
- 画像卡与作战窗窗口融合（刀3范围，用户明确要求不提前做）

## 下一步
- 重新构建agent-panel-web，替换xian-rog v2.0.94，真机验证点击收起按钮真的能收起（不只是热键）
