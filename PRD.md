# Commander正式无工具证据判读与失败诊断
Task: 8763450e-3335-4da9-a9bb-352db3d27bf9
GP-Anchor: line02/keyword_acquisition keep-green

原db2239 AFTER调用传CLI --timeout60，真实run执行60003ms超时。准备提交约2.424s后，57.616s未收到最终完成；底层原因未知，pendingStage默认值不证明队列或模型挂死。

旧请求口头禁工具但实际compiled59工具。改用现役Gateway agent modelRun=true的正式per-run disableTools权限收缩，保同work-commander/session/业务scope、thinking low、60s/外层65s、最终回执与原ownerpending。不得改共享agent配置或把timeout/active0当全集停止。受控诊断只固定phase/status/run/elapsed/timeoutkind，禁prompt/argv/环境/原异常泄漏。

modelRun为正式单回合模型判读，不追加原负责人聊天历史；仍固定同owner/sessionKey与完整receipt/workflow_progress。Skill接手保原完整负责人入口，不使用modelRun冒接手权限。错误旁证在原owner目录wx追加固定scope/状态/耗时，不清pending也不作执行权证明。

不改sampling、手机动作、业务DB、配额、政策、Skill执行许可或生产。权限收缩不宣称修好历史57秒底层。永久真实子进程RED先提交，代码检查点45分钟，完整CI及隔离候选另验。

续接说明：原09b9547d租约失效FAILED保持，当前8763450e接续同一审定实现；正式单次modelRun实测为embedded/OpenClaw无工具判读，不使用原Codex app-server线程或原durable历史，不据此认定历史超时原因已修。
