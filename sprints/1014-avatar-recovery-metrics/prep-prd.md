# 正常头像恢复与身份重扫分别计数

GP-Anchor: line02/keyword_acquisition keep-green

真实B3两次rescan-3/6均avatar_unavailable，5新评论/采样/历史PG已通过，混用计数触发两个旧rescan gate。仅区分实际avatar与identity恢复；旧阈值0.3不变，正常头像计数不伪0、缺计数不能pass。两类恢复共同留span attempts/fallback事实。原return_to_results只是身份兜底率代理，102不产生搜索归位证据。保留B3原failed及PG事实，不真机/部署/业务写。

验收：真实shell两头像恢复+五LEAD；wrapper严格计数/缺失拒绝；部署Step及实际probe原门槛不变；runtime HTTP回执两类计数真实保留；report1.0.6/Commander2.0.5同步固定冻结。
