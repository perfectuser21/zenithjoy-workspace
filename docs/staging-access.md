# 常驻 staging (:5201) 访问指南

> **2026-07-30 更新**：本文之前描述的"美国 mmv 常驻 staging"架构已过期——拆库刀3-T3
> （2026-07-14）把 staging 从 mmv 本机 launchd 迁到了 HK VPS 的 Docker 容器，
> T5（2026-07-15）又把生产也迁了过去。**现在生产和 staging 是 HK 同一台机器上的
> 两个独立 API 容器，共用同一个 Postgres 容器实例，只用库名区分**（见下方「架构」）。
> 本次更新由 Brain issue 88d15763（P0 根因排查：测试 license/租户在生产库和
> staging 库各播种一份，导致真机误连生产无感知）核实确认。
>
> main 合并触碰 `apps/api/**` → GitHub Actions 自动部署候选到 HK staging 容器
> （`deploy-staging-hk.yml`，端口 :5201，连 `zenithjoy_staging` 库，无客户流量），
> 并跑过 golden-path。**人工打开 staging 看过、确认 OK，再去 Actions 手点
> `promote-prod-hk.yml` 放行到生产 :5200。** 本文给访问 staging 的道 + 架构说明。

---

## 架构：生产和 staging 共用同一个 Postgres 容器

HK VPS（Tailscale `100.86.118.99`，别名 `vps-hk`）上跑三个关键容器：

| 容器 | 镜像 | 宿主端口 | 说明 |
|---|---|---|---|
| `zenithjoy-api-prod` | `zenithjoy-api-prod:latest` | `127.0.0.1:5200` | 生产 API，域名 `https://autopilot.zenjoymedia.media` |
| `zenithjoy-api-staging` | `zenithjoy-api-staging:latest` | `127.0.0.1:5201` | staging API，域名 `https://staging-autopilot.zenjoymedia.media` |
| `zenithjoy-db-postgres` | `postgres:17` | `127.0.0.1:5432` | **两个 API 容器共用的唯一 Postgres 实例** |

**两个 API 容器都连同一个 `zenithjoy-db-postgres` 容器，只是 `DATABASE_NAME` 不同**：

| | `zenithjoy-api-prod` | `zenithjoy-api-staging` |
|---|---|---|
| `DATABASE_HOST` | `zenithjoy-db-postgres` | `zenithjoy-db-postgres`（同一个）|
| `DATABASE_NAME` | `zenithjoy` | `zenithjoy_staging` |
| `DATABASE_USER` | `zenithjoy` | `zenithjoy`（同一个角色）|
| `DATABASE_PASSWORD` | 同一份密码 | 同一份密码 |

验证（在 HK 上）：
```bash
ssh root@100.86.118.99   # 走 Tailscale，见下方「访问」
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -E 'postgres|zenithjoy'
docker exec zenithjoy-api-prod printenv | grep DATABASE_NAME     # zenithjoy
docker exec zenithjoy-api-staging printenv | grep DATABASE_NAME  # zenithjoy_staging
docker exec zenithjoy-db-postgres psql -U zenithjoy -d postgres -c '\l'  # 两库都在同一实例里
```

**这意味着什么（安全含义）**：
- 生产/staging 的隔离**完全依赖每个 API 容器 `.env` 里的 `DATABASE_NAME` 配对正确**，
  不是网络隔离、不是不同的数据库账号密码。改错一个环境变量、或者一个客户端错连
  到了 `zenithjoy`（而不是 `zenithjoy_staging`），数据库层面不会有任何天然信号拦下来。
- 同一个 Postgres 角色 `zenithjoy` 对两个库都有权限——凭据一旦泄漏，两个库同时暴露。
- 2026-07-30 真机验证车道调试时，就是因为一台测试设备的客户端配置指向了错误的
  环境（而不是数据库层面的原因），心跳误连到了生产的 `zenithjoy` 库而非预期的
  `zenithjoy_staging`。审计过程中进一步发现同一个测试 license/租户在两个库里各播种
  了一份，导致误连后走标准注册流程也"成功"、没有任何信号能让人发现连错了环境——
  这个漏洞已经在 `apps/api/src/services/license.service.ts::registerAgent()` 里
  修了（`is_test` license 在 `NODE_ENV=production` 的 API 进程里会被显式拒绝，
  见 Brain issue 88d15763），但**代码层的这道闸门是纵深防御的最后一环，不能代替
  客户端配置正确指向环境**。

---

## 访问：SSH 到 HK VPS（走 Tailscale）

**必须通过 Tailscale，不能直接连公网 IP**（`43.154.85.217` / `124.156.138.116` 的 22 端口不通）：

```bash
ssh -o StrictHostKeyChecking=no root@100.86.118.99
```

进去之后：
```bash
curl -s http://localhost:5201/health    # staging，应返回 ok
curl -s http://localhost:5200/health    # 生产，应返回 ok
```

本机自己开浏览器看 staging dashboard，走 Cloudflare 公网域名即可（下面「公网域名」一节），
不需要再配 SSH 端口转发——staging 已经有稳定公网地址，不像迁移前那样只能转发到本机
Mac 才能访问。

---

## 公网域名（同事直接用，已就绪，不需要额外配置）

生产和 staging 都已经挂在 Cloudflare Tunnel 后面，各自独立域名，**不需要额外的
Access 邮箱白名单闸就能访问**（如需收紧访问，另行按 cloudflared skill 加 Zero Trust
Access 策略，不在本文范围）：

| 环境 | 域名 | 连的库 |
|---|---|---|
| 生产 | `https://autopilot.zenjoymedia.media` | `zenithjoy` |
| staging | `https://staging-autopilot.zenjoymedia.media` | `zenithjoy_staging` |

```bash
open https://staging-autopilot.zenjoymedia.media/health   # 应返回 ok
open https://staging-autopilot.zenjoymedia.media          # 打开 staging dashboard
```

---

## 人工验证 instruction（放行前必走）

打开 `https://staging-autopilot.zenjoymedia.media`，确认下列都 OK，再去 Actions
手点 `promote-prod-hk.yml`（confirm 框输入 `PROMOTE`）：

| 步骤 | 操作 | 应看到 |
|---|---|---|
| X | 开 `…/health` | `ok`（200） |
| Y | 开 `…/version` | `sha` = 本次候选 commit（与你要放行的一致） |
| Z | 开 staging dashboard 首页，走本次 PR 改动相关的页面/动作 | 改动生效、无报错、无白屏；本次 PR 描述里声明的「应看到的变化」真出现 |

任一不对 → 不要 promote，回去修。staging 连的是 `zenithjoy_staging` 库，随便点
不影响客户——但记住上面「架构」一节的教训：这道隔离是配置层面的，不是数据库
账号层面的，改配置/加新环境变量时格外小心 `DATABASE_NAME` 有没有指对。
