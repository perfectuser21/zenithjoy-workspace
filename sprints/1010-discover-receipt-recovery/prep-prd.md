# 发现队列丢回执恢复

正式619发布AI30，14次取链成功，13条确认入库；第14条队列RPC返回无合法回执而提前结束。只针对discover唯一键upsert：传输丢回执后在原总预算内精确读回业务线+真实ID+本次URL；确实无匹配行才按相同请求补写一次。显式源校验、数据库错误、其他写操作不重试。采集候选先记本批待写证据，失败不丢原始ID与URL，不计成功。

任务713e4691-6fb1-444c-9e1a-bd5a8cea28b7，实测证据/tmp/codex1010115648_ai30peer_101-independent-final-readback.json。

GP-Anchor: line02/keyword_acquisition#step2
