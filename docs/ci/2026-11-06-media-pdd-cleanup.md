视频与拼多多 CI 清理基于 main `9acfa9a469a312396d6209465a80591af3cefe97`，在独立 worktree 中完成。保留现役工作流和所有原有业务断言。

- 本地视频 smoke 不再默认生产地址或携带内置 license；只接受显式授权的 loopback fixture。真实 HTTP/私有 PostgreSQL 执行整个脚本，核验 `.job`、输入字段、完成状态与持久读回，并拒绝错误 envelope 和假完成200。
- API/provider 与 Dashboard 合同归并至已有 media canonical，去掉 video-tools 重复运行的6个套件；保留独有画布扩展、3份分发图和真实 Python 节点方法测试。
- PDD 的427个原有离线业务合同全部保留。新 Node/Python 收集器对每个输入文件检查实际命名用例，拒绝空文件、skip、todo、import失败；不会把 Node 的“空文件自身通过”当断言。由现行 required product-delivery 脚本执行自身负例守卫。
- 清偿修复脚本的假绿债，同时删去7个已不存在媒体 alias 的陈旧例外；注册3份新测试。

验证结果：媒体 API309、Dashboard65、PG16；混剪组件27；画布 Node8/Python6；PDD与收集器守卫454；CI接线回归34。所有相关收集均0 skip，registry、46项sync、selfcheck和产品地图通过。完整命令、日志及SHA256见同名JSON。

当前 main 的 Smoke Glob 与翻拍 orphan 实际步骤通过。两个 Windows 独立工作流最近一次成功是10月21日；10月18日旧失败都停在技能源恢复，并非业务断言失败。保留混剪的真实API/PG+浏览器层和现役9节点UI测试，不把它们等同Wan3真实模型交付。Content Clipper是独立内容采集功能，不因名字相似而当视频剪辑重复项删除。

没有真实模型调用、真机操作、商品发布或生产写入。候选云端 CI 尚待父任务集成后执行。Brain建单错误由父任务记录，本分支没有伪造或复用完成任务ID。
