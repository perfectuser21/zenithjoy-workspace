# ZenithJoy 生产发布与回退

香港运行 API 和 Dashboard 预发。杭州运行生产 API 和数据库。杭州和香港兼容域名由同一个工作流更新 Dashboard。

| 组件 | 操作手册 | 核对范围 |
| --- | --- | --- |
| API | [杭州生产 API 发布](../scripts/deploy/HANGZHOU_API_RELEASE.md) | 杭州容器与两个生产域名的 API 版本 |
| Dashboard | [Dashboard 生产发布与回滚](../scripts/deploy/DASHBOARD_PRODUCTION_RELEASE.md) | 杭州与香港入口的 Dashboard 版本与前端文件 |

两个工作流共用生产切换队列。需要联合交付时，按两个手册分别验收候选和核对生产结果。API 与 Dashboard 各自记录前驱并独立回退。Dashboard 发布失败时会尝试恢复两地的前端版本。已成功晋级的 API 需通过 API 工作流单独回退。

Staff Hub 的预发和生产工作流均已退出常规发布并保留历史。可查阅 [Staff Hub 预发记录](https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/41851355976)与[生产记录](https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/30348436001)。

2026 年 6 月的 Mac 蓝绿切换步骤及香港单站 Dashboard 回退命令见[原历史手册](https://github.com/perfectuser21/zenithjoy-workspace/blob/fc8a494c02a8702e89c9a2a20e3cc3c32ce85a2c/docs/blue-green-cutover-runbook.md)。
