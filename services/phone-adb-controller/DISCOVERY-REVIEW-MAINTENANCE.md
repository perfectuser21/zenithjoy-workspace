# 原悦升101单owner维护入口

本工具仅适用于原 `252225f13a47ed36e95c248e916373c4c462fffd`、`ys261104032759_101`、`ANGYVB4311010223`。原件及两个leaf账的预期SHA固定在 `discovery-review-maintenance-contract.json`，调用者不能传期望hash、owner或新来源替代原件。

恢复依据：原cleanup内部attempt证明已进入handler，固定原execution记录的后置UNKNOWN错误发生在await调用返回后；cleanup的finally必须先成功await producer.close。完整原runtime冻结闭包、唯一原事件与1468条native叶子的真实close账共同证明旧phone请求域封闭。客户端断连仍可能使原producer的returnUnknown为true；证明不会重建原WeakMap能力，也不证明OS任意后代或Android远端所有进程停止。原native UNKNOWN和失败101均保持不变。

协调者先完成独立审查、完整CI和固定commit工具分发，再在M4服务账号运行（工具目录为固定已审查commit的归档，不修改原run/runtime）：

```sh
python3 /固定工具目录/services/phone-adb-controller/discovery-review-maintenance-host.py plan 候选SHA M4候选release_id
python3 /固定工具目录/services/phone-adb-controller/discovery-review-maintenance-host.py apply 候选SHA M4候选release_id
```

当前候选的安装manifest按正式 `observeDeployment` ABI不含 `observed_hostname`。工具现场调用系统hostname，按现有机器映射核目标，再逐文件重算hash并保留manifest原数组顺序，重建实际观测体；其摘要必须匹配Brain当前observation的 `evidence_ref`，不接受manifest自报hostname。

Android 15的HOME解析可在ActivityInfo和嵌套ApplicationInfo重复给出同一packageName；仅当所有记录均为合法且唯一同包时归一化。当前focus原文仍交原严格核验，任一非HOME或缺失focus不通过；通用旧恢复判据不修改。

`plan`只读。`apply`必须重新核本次任务claim、原件完整hash、当前候选manifest与Brain gate、自动入口关闭和当前HOME/focus；桌面探测使用原冻结ADB二进制hash与既有数值endpoint，只读、不发HOME键、不启动server。持两根现有guard后再次核全部前置，单durable原owner目录经journal和inventory CAS归档。legacy目标必须始终不存在；migration marker及其他两个旧review owner的原字节保持不变。中断后使用相同命令重入，只接受journal登记的before/after状态。

维护journal：`~/.config/zenithjoy/discovery-review-maintenance/`。工具不会释放中央租约：当前中央接口缺少run/fence CAS，协调者必须独立处理原任务终态及读回，不能假称已做fenced release。恢复业务须另走正常新101→102→103，不能将原失败101来源伪装为completed。

本地验证：

```sh
python3 services/phone-adb-controller/__tests__/discovery-review-maintenance.test.py
python3 services/phone-adb-controller/__tests__/discovery-review-lock.test.py
python3 services/phone-adb-controller/__tests__/discovery-review-host.test.py
python3 services/phone-adb-controller/__tests__/discovery-review-candidate.test.py
python3 services/phone-adb-controller/__tests__/discovery-review-desktop.test.py
DISCOVERY_REVIEW_ORIGINAL_FIXTURE=/原run完整只读副本 python3 services/phone-adb-controller/__tests__/discovery-review-maintenance.test.py
```

真实原run验证还检查341个冻结runtime文件、13份原件hash与2个scope全集；真实原件不提交仓库。普通CI运行隔离的纯逻辑和临时锁目录测试，fixture环境变量只用于测试副本，不参与生产授权。
