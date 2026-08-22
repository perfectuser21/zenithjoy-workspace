# 小改动 PrepPRD：刀C 私信链定位类批量铺满
## 归属
AI on-call 铺满刀C。锚 line02/keyword_acquisition keep-green。
## 改什么
DouyinDmOutreachService 三个剩余定位判死点，判死前先 tryLocatorAssist（复用刀2b helper）：
- NO_DM_ENTRY（私信入口）step=dm_entry target="私信按钮/入口"
- NO_MESSAGE_INPUT（消息输入框）step=dm_message_input target="私信消息输入框"
- NO_SEND_BUTTON（发送按钮）step=dm_send_button target="发送按钮"
候选拿到→当对应 node 用→本步既有验证逻辑=验证闸→回执。fail-open 走原判死。bump 2.1.39。
## 验收
- [ ] commit-1 接线守卫；[ ] commit-2 转绿+回归；[ ] CI 全绿
