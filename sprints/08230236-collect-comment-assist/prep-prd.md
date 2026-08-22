# 小改动 PrepPRD：刀C2 采集链评论按钮定位保底
## 归属 AI on-call 铺满刀C2。锚 line02/keyword_acquisition keep-green。评论按钮找不到=零线索。
## 改什么
DouyinCollectService 加 locate 版 tryLocatorAssist（镜像 tryExtract，mode=locate，返回 node）；
NO_COMMENT_BUTTON 判死点判死前问一次(step=collect_comment_button, target=评论按钮)，
候选拿到当 commentBtn 用→clickCommentButton→后续评论面板出现即验证闸。bump 2.1.40。
## 验收 commit-1守卫 / commit-2转绿+回归+tsc / CI全绿
