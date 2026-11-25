# 共享 API 的视频工具发布

香港旧 Creative Canvas（ComfyUI）已退役。员工 AI 视频画布使用独立的 Toonflow 发布流程。旧 Dashboard 画布和 React Flow 翻拍原型已从部署源码移除，旧画布网址返回 HTTP 410。普通视频翻拍流水线与模型及素材 API 继续提供服务。

- 普通共享 API 发布继续走同版本的 staging 和生产验收。部署和回退不再检查、配置或启动 ComfyUI。
- 新 API 配置将旧画布实例和服务令牌映射置空，并保留已配置的千问、阿里云、COS 和员工名单设置。
- 历史发布回执和 ComfyUI 数据卷保留。普通共享 API 发布不需要读取这些卷，也不需要启动其中的历史工作流。

共享 API 通过 `deploy-staging-hk.yml` 在香港部署预发候选。生产 API 运行在杭州。发布入口与回退状态见[预发访问与生产版本核对](../../docs/staging-access.md#生产发布与回退)。
