# 获客回执的可核 Git 来源

任务 fa58ae89-c080-40a3-acf0-2e25f47f5d47；承接 d4c3f808-c68d-4b15-9fd7-04b3dedb949a。line02/keyword_acquisition，预检开账本及全部活动回执。

生产 workflow-result.sh 三个回执面缺 source_sha，无法把新批效果对应到实际部署版本。正规部署从 clean Git 对象生成来源清单，运行时核仓库、producer路径、执行 inode 字节 hash，再传播同份来源到本地工件、Brain result、span evidence。不补旧批、不改活生产批及阶段3独立目录，不冒用工件 hash 作 Git revision。无法核实一律 null/unknown。
