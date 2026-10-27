# 单条pending视频的跨版本来源交接

Task: 8ce977d8-fc05-4310-ac30-23b7bd710b90
GP-Anchor: line02/keyword_acquisition keep-green

## 问题与范围
已验证a83/beb原101保存两条真实视频，当前单5037候选不能消费旧source。仅增加显式v2描述符交接仍pending的7689863996204591985；770011隔离记录不恢复。旧v1和无描述符同source路径不变。

## 验收
- 原完整来源run snapshot fe7da095及progress fbbee23e固定；全部2VID/captures不裁剪，新consumer真实source。
- 公司/租户/v14/原policy/legacy/设备4402及唯一VID严格校验；只允许队列1条、最多5评论，unknown指标后续重读，不当0。
- 在同一真实PG事务中CAS pending+待判定+原a83harvest_batch；失配/租约/隔离/政策漂移不领取，不换领。
- 保旧来源、旧失败与UNKNOWN；不新增搜索、手机操作、恢复、私信或业务PG写。

## 测试策略
CI：真实原progress压缩fixture和固定哈希/身份验证；shared readFrozen原v1真实正例保持，新v2错误来源阴性；scratch Postgres原子CAS、并发和漂移永久回归。CI不冒v2全281源文件正链。
本机/候选：以真实原完整run目录执行readFrozen+v2只读正集成，独立记录结果；真实102/103另独立业务任务，不用本代码CI冒业务通过。
