# 验收

- 丢回执但已提交只读回，不重复写。
- 读回缺行才同请求补写一次，源SHA不变，总截止时间不扩大。
- 读回失败不得盲补写；明确错误及其他写操作不自动重跑。
- 丢失回执时待写原始候选证据可查，计数如实partial。
- 正式发布smoke与Linux CI通过。

GP-Anchor: line02/keyword_acquisition#step2
