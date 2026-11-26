# 杭州生产 API 发布

自 2026 年 11 月 23 日起，生产 API 和数据库位于杭州。杭州 `zenithjoy.tech` 直连生产 API，香港旧域名 `autopilot.zenjoymedia.media` 转发 API 流量。两个域名分别提供自己的 Dashboard。本文的操作仅切换杭州 API 容器。

## 发布

1. 固定已合入 `main` 的完整提交 SHA。确认 [Deploy API to HK staging](../../.github/workflows/deploy-staging-hk.yml) 最新一次同 SHA 运行通过，且同一个运行及尝试号产出 `hk-api-candidate-<run_id>-<attempt>`。候选保留 14 天。保留期过后，从当前 `main` 重新准备候选和同版本验收。
2. 用现行 [release admission](../../.github/workflows/release-admission.yml) 要求的同 SHA、同次 staging 尝试、`api` 范围真实业务验收获取 `acceptance_run_key`。由 [Hangzhou production API release](../../.github/workflows/hangzhou-api-release.yml) 在 `main` 手动运行 `promote`，填完整 SHA、验收键和 `PROMOTE`。
3. 查发布日志中的 `HZ_RELEASE_CURRENT` 和 `HZ_RELEASE_PREVIOUS`。发布器同时验证杭州宿主容器、`zenithjoy.tech` 和香港旧域名的健康及完整 SHA。通过准入后，它复用预发镜像，校验归档、配置及镜像层，保留前驱镜像。

杭州数据库的迁移文件清单必须与候选完全匹配。出现 `pending`、`extra` 或生产身份不符时，日常入口在切换前停止。涉及数据库变更的发布应先走单独审查的正向迁移，确认回退目标与新 schema 兼容。应用版本回退只能切换镜像。

## 回退

先在 `main` 手动运行 `inspect`，查看当前、前驱和待恢复状态。选择记录中的完整前驱 SHA，运行 `rollback` 并填 `ROLLBACK`。任务重跑保持指向原 SHA。首次成功晋级前，当前宿主可读出版本，但还没有经此流程留存的前驱。遇到待恢复状态时，以同一日志中标明的已验证前驱 SHA 执行回退。

迁移、生产编排或实际镜像发生记录外变更时，入口会拒绝切换。应先核对实际环境及既有发布记录，再决定如何恢复。两域 Dashboard 分别走自己的发布验收。
