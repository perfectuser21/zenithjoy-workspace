# ZenithJoy 预发访问与生产版本核对

2026 年 11 月 23 日，ZenithJoy 生产 API 和数据库切换至杭州。香港继续提供 API 预发、Dashboard 预发和旧生产域名入口。

| 环境 | 公网入口 | 运行位置 |
| --- | --- | --- |
| 预发 | [staging-autopilot.zenjoymedia.media](https://staging-autopilot.zenjoymedia.media) | 香港。API 容器 `zenithjoy-api-staging` 监听宿主 `127.0.0.1:5201`，使用香港预发库 `zenithjoy_staging`。 |
| 生产 | [zenithjoy.tech](https://zenithjoy.tech) | 杭州。杭州 Nginx 提供 Dashboard，通用 API 请求由杭州生产 API 容器处理。 |
| 生产兼容入口 | [autopilot.zenjoymedia.media](https://autopilot.zenjoymedia.media) | 香港提供 Dashboard，并将通用 API 请求转发到 `zenithjoy.tech`。 |

生产与预发使用各自宿主上的数据库实例。真机验收应核对客户端的 API 地址和预发身份。Brain issue `88d15763` 记录了测试设备误连生产的情况，以及生产 API 对测试许可的拦截。

## 预发入口

[API 预发工作流](../.github/workflows/deploy-staging-hk.yml) 和 [Dashboard 预发工作流](../.github/workflows/deploy-dashboard-staging.yml) 在香港部署各自的候选。核对预发结果时，分别读取 API 与 Dashboard 的版本。

```bash
curl -fsS https://staging-autopilot.zenjoymedia.media/api/health
curl -fsS https://staging-autopilot.zenjoymedia.media/api/version
curl -fsS https://staging-autopilot.zenjoymedia.media/release-sha.json
```

API 健康状态应为 `ok`。对照本次验收组件，确认 API `/api/version` 或 Dashboard `/release-sha.json` 的 `sha` 与对应候选一致。用预发账号走完本次改动影响的业务操作，并记录同一候选的结果。

如果要区分预发公网代理和 API 容器故障，通过 Tailscale 登录已配置的香港 VPS，再读取本地健康结果。

```bash
ssh hk-vps 'curl -fsS http://127.0.0.1:5201/health'
```

## 生产发布与回退

杭州 API 的日常晋级、回退和只读核对走 [杭州生产 API 发布](../scripts/deploy/HANGZHOU_API_RELEASE.md)。缺少生产迁移记录的候选会在切换前被拦截。香港 API 的 `promote-prod-hk.yml` 和 `rollback-prod.yml` 已停用。香港 Dashboard 的两个旧生产按钮也已停用，两个域名的 Dashboard 生产入口需分别核对。

可以从两个生产域名只读核对 API 与 Dashboard 版本。两个域名分别提供 Dashboard 静态站点，核对 Dashboard 发布时应读取两份前端回执。

```bash
for origin in https://zenithjoy.tech https://autopilot.zenjoymedia.media; do
  curl -fsS "$origin/api/version"
  curl -fsS "$origin/release-sha.json"
done
```
