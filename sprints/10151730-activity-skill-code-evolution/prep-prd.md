# PRD：获客 Activity Skill/Code 配套与升级一致性

Task: 651eb174-06bc-4d3d-94dd-2d37850cbf17
Parent: bfcdbe26-f2cc-4f0f-bca4-ab6970e598e6
GP-Anchor: line02/keyword_acquisition keep-green
Base: 5235d8f797ec294f947d4b86e6c782c7755af582

## 用户目标

修复只改Code、未更新Skill导致失败后旧方法不能可靠接手的缺口。Activity是业务工作；Skill是方法，Code是其自动化实现。先以Skill跑通并核验，再固化Code；方法变化必须更新Skill及受影响Workflow引用，不能将方法/合同版本混为一谈。

## 已有与本次范围

保持四独立Workflow与原14个引用位、12个Activity真身；101共用102预检/收尾，104既有独立预检/收尾继续独立。沿用原Company配置、评分政策、发送额度及幂等和锁约束。

本次新增12份独立Activity Skill，把原先指整Workflow Skill的12个owner binding改为独立方法绑定。四份Workflow Skill和四份Commander Skill升0.2.0，逐活动登记方法依赖。通过同一锁清单核对Skill和支持文件、原Activity合同版本、完整Code绑定字节及消费者引用。

代码内部优化可保留方法版本，但必须用明确兼容评估绑定前后完整代码集合摘要。方法或支持文件改变须升方法版本并同步所有消费者；共享方法变更不能漏101或102其中之一。业务合同版本按合同变化另行管理，不因新增方法文件机械抬版本。

## 预期可观察路径

1. 开发者选择Activity，能查到唯一方法Skill、版本、Code及消费者。
2. 只改方法不升版或漏更新Workflow，正式检查失败并指出具体引用。
3. 升级对应方法与受影响Workflow/Commander依赖，检查通过；无关兄弟Activity无需强制升级。
4. 内部Code优化经精确兼容评估通过，错误/过期摘要仍拒绝。
5. 部署清单包含新方法文件及引用，独立验收区分文档/配套通过与实机接手通过。

## 测试策略

离线smoke使用真实四合同与真实Git基线，对同版正文/支持文件漂移、消费者旧引用、版本倒退、错owner、误合并104头尾、Code兼容摘要错误做负例；保留正常窄升级和内部兼容优化正例。现有product-map、Source绑定、部署清单与完整获客测试回归。独立Skill场景评估不发送、不操作手机、不写业务PG。

不把本次文件配套冒充自动handoff实现；单Activity公共执行接口仍缺，实际Code失败接手另需正式接口与实机验收。四生产Workflow保持暂停，原102音轨静音问题未在本变更修复。
