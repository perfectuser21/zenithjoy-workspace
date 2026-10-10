# Pilot隔离环境测试目录

用户已授权修复并跑通最新获客。PR2111同main正式Pilot已核快照无缺口，但回归因测试继承HOME假设失败；本地移除HOME已复现init导出失败。

GP-Anchor: line02/keyword_acquisition#step2

两组workflow-result测试显式用各自临时目录作为HOME，确保默认配置路径不会接触个人凭据。保持正式Pilot环境白名单；正式smoke增加清除HOME的实际初始化和span上报守卫。

验证：先保存无HOME初始化失败证据，再核相同用例通过、两组全部测试通过，以及整个leadgen smoke在Pilot环境白名单下通过。主线Pilot正式通过后部署并启动101→102→103/send0。
