# Activity 方法、代码和交接约束

Activity是可验收的业务工作；Skill是执行方法，Code是该方法的自动化实现。方法版本和业务合同版本分别管理。调用前先跑 `npm run leadgen:methods:check`；开发变更再用 `npm run leadgen:methods:check -- --base <真实基线SHA>` 比较演进。

## 执行与接手

1. 加载本run冻结的Activity合同、方法Skill及支持文件、Workflow依赖、代码Source和Company配置。方法不兼容、来源不一致或版本缺失即阻断，不就近挑旧Skill。
2. Code按该Activity已经批准的重试次数、可重试错误和总截止执行；没有配置不能自行新增无限重试，也不把本文当作已经安装了重试器。
3. Code失败交Commander核对最早错误、持久进度、旧执行者与外部结果。确认执行者停止或有安全独占权交接后，再由匹配方法Skill续接同一Activity、任务、身份及截止。
4. 结果未知的外部动作先读回；已发送不重发，已提交不重复制造数据。保留原Code失败和Skill接手证据，从最后确认处继续，不把“回档”理解成撤销外部事实。
5. 没有合法单Activity入口、持久交接接口或可用权限时给出blocked原因；不得直接import内部队列、裸写PG、调用整流程冒单步或重启共享服务。
6. Skill仍失败或预算结束时停止本轮业务，保留部分成果、准确失败/未知原因及资源清理结果。Commander基于证据汇总成功、部分完成、失败或待确认，不把缺证据猜成成功。

本轮源码增加leadgen-activity-v1与原run私有broker入口，真实work-commander父会话→官方sessions_spawn→同slot工具→原独立verify闭环。它不是整Workflow重启入口；当前方法仍需独立实机验收，源码通过、正式发布、生产启用与实机接手分别留证。

## 升级

- 首次先用Skill把工作做成并独立验证，再将稳定动作固化为Code；固化后仍保留同一Activity的Skill。
- 方法、页面操作、业务规则、输入输出或恢复方式变化，升级对应Skill方法版本，更新消费者依赖清单与Workflow Skill、Commander Skill版本并重新验收。支持文件变化也属于方法变化。
- 业务承诺、输入输出或读回合同变更按Activity合同semver办理；只改执行方法不机械抬业务合同版本。共享Activity变更先列所有消费者，不能只更新其中一个流程。
- Code内部优化若不改变方法或业务合同，可保持Skill版本；须用明确的兼容评估绑定前后代码集合哈希、理由和reviewer。不能仅刷新哈希就宣称兼容，更不能让兼容声明掩盖Skill正文变化。
- 同版本Skill文件不可悄改；正在运行的任务保留原冻结组合，新版本供新运行使用。配套通过、代码通过、Skill实机通过、自动接手通过是不同证据，不互相冒用。

## leadgen-activity-v1工具约束

只有原run失败边界可创建request，方法来自冻结Activity binding与实际字节；MMV起跑前重读中央run/definition/Activity及同源Skill。child先验自己的官方绑定；inspect仅读原状态，phone只可读证/受控归位，resume至多一次且只运行原slot成熟handler。原失败和接手证据分开记录，原verify通过才写成功。send_dm始终readback_only，不重发、不凭自述补发送事实。未知child或仍在飞的原动作保持锁、阻止后续业务与cleanup。

102 qualification恢复保持原已领取VID和成功集合，只失败VID生成一次新recovery EID；不重claim、不重录成功VID。已部分写入的collection暂不允许自动resume，保留原新增/覆盖计数并明确blocked，不能当成0条成功或承诺已救回。

child在MMV通过同源 `leadgen-skill-agent.mjs tool <本次私有handoff目录> inspect|phone|resume` 调用固定relay；phone参数走stdin JSON，不由模型拼SSH。relay只用冻结target对应的现有受管SSH别名并严格校验host key，不新增网络跳板；实际冷连接与原生播放故障恢复仍待独立实机证据。

旧执行或child终态未知时禁止重试、接手及清场；原进程通过精确owner的lock-quarantine写既有standalone_review_required并读回，已领VID只用同line/run/VID的CAS隔离到待人工核验状态并读回。隔离回执未知必须明确unknown，不宣称保有无限租约；普通设备1800秒/视频15分钟TTL不变，已确认隔离态不得自动陈旧回收或重领。
