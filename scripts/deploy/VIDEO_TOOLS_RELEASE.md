# 共享 API 的视频工具发布

香港旧 Creative Canvas（ComfyUI）已退役。员工 AI 视频画布使用独立的 Toonflow 发布流程。

- 普通共享 API 发布继续走同版本的 staging 和生产验收。部署和回退不再检查、配置或启动 ComfyUI。
- 新 API 配置将旧画布实例和服务令牌映射置空，并保留已配置的千问、阿里云、COS 和员工名单设置。
- 历史发布回执和 ComfyUI 数据卷保留。普通共享 API 发布不需要读取这些卷，也不需要启动其中的历史工作流。

香港共享 API 的预发入口为 `deploy-staging-hk.yml`。生产仍通过 `promote-prod-hk.yml` 使用已经验收的同版本候选。
