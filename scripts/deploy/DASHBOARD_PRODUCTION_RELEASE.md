# ZenithJoy Dashboard 生产发布与回滚

香港负责预发。杭州负责生产，`autopilot.zenjoymedia.media` 是旧生产兼容入口。两个生产域名由一个工作流更新，并分别核对各自实际返回的前端文件。Dashboard 与杭州 API 共用生产发布队列。切换时依次重启两台 Nginx，经过对应入口的连接可能短暂重连。

## 晋级

将候选部署到香港 [Dashboard 预发](../../.github/workflows/deploy-dashboard-staging.yml)。从 `main` 可以先单独运行 [Dashboard 业务验证](../../.github/workflows/dashboard-release-verification.yml)，查看登录、测试公司配置草稿保存、独立读回和还原的回执。工作流绑定当前前端和 API 的完整 SHA、预发运行及尝试编号。验证账号只访问香港隔离租户的专用草稿。

从 `main` 手动运行 [ZenithJoy Dashboard production release](../../.github/workflows/zenithjoy-dashboard-production.yml)，选择 `promote`，输入 SHA 和 `PROMOTE`。本次运行会重新执行同一验证，并核对两个生产域名是否支持候选使用的公司设置和选题接口，再开始构建。发布前还应核对候选实际改动影响的页面。

工作流对已验收的提交构建一次生产包。杭州站和香港兼容入口先分别收包验摘要，随后依次切换。两边版本与前端文件均经回读后，日志才会显示新的 `current`。切换或回验失败时，发布器会尝试把两边恢复到同一前驱，核对恢复结果后才清除待恢复记录。

## 只读核对与回退

从 `main` 运行 `inspect`，查看 `current`、`previous` 和 `pending`。首次成功切换后会出现已留存的前驱。正常回退时选择 `rollback`，填入 `previous` 的完整 SHA 和 `ROLLBACK`。若有未完成的切换，回退目标使用 `current` 所示的已确认版本。重复执行同一回退目标会再次核对实际版本。

该工作流管理 Dashboard 前端文件。API 使用[杭州生产 API 发布](HANGZHOU_API_RELEASE.md)。香港 staging 和旧生产域名是不同入口。
