# 双范围发布验证的部署证据消费

共用workflow把artifact命名改为scope加SHA后，部署下载器仍使用旧无scope名称，导致主线验证成功却无法自动部署。新MMV发布又需要两个范围的完整定义闭包，不能只改成读取其中一份。

- 生产者名称改变时，同时检查精确名称的下载消费者及最终部署闭包。
- 同一成功main run必须同时具备 `pilot-release-verification-zenithjoy-<head_sha>` 与 `pilot-release-verification-commander-generic-<head_sha>`；任一缺失或重复立即拒绝，不回退旧名。
- 保留顶层zenithjoy数据并追加commander完整证据；按各自scope核对来源repo/SHA、快照和报告回执摘要，防止范围串用。部署预检继续验证完整定义、组件字节与回归断言。
- 红测试 `5b882a05` 复现旧名称错误，`1dec4d4b` 复现缺第二scope及串用风险；真实ZIP和双scope回归永久保留在既有L3 CI。

同一environment+target的观测必须对应完整workflow闭包，不能用两份同目标release依次部署来维持旧新入口。MMV聚合观测纳入真实跨host绑定，但旧runtime本机manifest只能保留本机files；多个根共享一个release/ACK。部署互斥位于MMV，覆盖上传至正式观测读回，SSH锁通道丢失终止部署，失败保留admission标记。永久回归包括七加四闭包、缺映射零SSH、真实HTTP观测顺序、安装文件/官方skill来源及内核锁竞争；相对路径执行新增红绿smoke防止cd后重入找错脚本。
