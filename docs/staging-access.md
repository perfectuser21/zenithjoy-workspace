# 常驻 staging (:5201) 访问指南

> 蓝绿加固 Line D（2026-06-25）。
> main 合并后候选会自动部署到 mmv（美国 Mac，公网 38.23.47.81）上的【常驻 staging 实例】
> `com.zenithjoy.api.staging`（端口 5201，连 `zenithjoy_test` 库，无客户流量），并跑过
> golden-path。**人工打开 staging 看过、确认 OK，再去 Actions 手点 `promote-prod.yml`
> 放行到生产 :5200。** 本文给两条访问 staging 的道。

---

## 道一：SSH 本地端口转发（自己用，已就绪）

把 mmv 的 `:5201` 转发到本机 `127.0.0.1:5201`，浏览器直接开 `http://perfect21:5201`。

### 一次性配置 `~/.ssh/config`

```sshconfig
# mmv = 美国 Mac（公网 38.23.47.81）。钥匙 = 1Password「ROGSSH」
# （mmv authorized_keys 已认 rog-1password-2026-06-13）。
Host mmv
    HostName 38.23.47.81
    User administrator
    IdentityFile ~/.ssh/rog-1password           # 1Password ROGSSH 私钥
    LocalForward 5201 127.0.0.1:5201            # mmv:5201 → 本机 127.0.0.1:5201
    ServerAliveInterval 30
    ServerAliveCountInterval 3

# 让 perfect21 这个主机名解析到本地转发端口
Host perfect21
    HostName 127.0.0.1
```

> 注：`perfect21` 在 mmv 本机 = `localhost`；在其他机器上，`Host perfect21 → 127.0.0.1`
> 配合上面的 `LocalForward` 即可让 `http://perfect21:5201` 命中转发端口。

### 用

```bash
ssh mmv            # 建隧道（保持这个会话开着）
# 另开浏览器/终端：
open http://perfect21:5201/health      # 应返回 ok
open http://perfect21:5201             # 打开 staging dashboard
```

隧道断了重连 `ssh mmv` 即可。钥匙从 1Password「ROGSSH」取，别硬编码进任何文件。

---

## 道二：Cloudflare Access 公网域名 + 邮箱登录闸（同事用，runbook）

给非本机的同事一个公网网址 `https://staging.zenjoymedia.media`，背后回源到 mmv 的
`http://localhost:5201`，前面套 Cloudflare Access 邮箱登录闸（只放白名单邮箱进）。

> ⚠️ **白名单邮箱待用户提供 + 用户在 Cloudflare Zero Trust 后台点**。下面是占位 runbook，
> 邮箱/域名拿到后照做。

### 前置

- `zenjoymedia.media` 已托管在 Cloudflare（生产 `autopilot.zenjoymedia.media` 已在用，确认同账户）。
- mmv 上已有 `cloudflared`（生产 dashboard 走 Cloudflare Tunnel；若没有按 cloudflared skill 装）。

### 步骤

1. **加 Tunnel 路由（mmv 上 / Cloudflare 后台）**
   在现有 tunnel 的 config（`~/.cloudflared/config.yml`）ingress 里加一条：
   ```yaml
   ingress:
     - hostname: staging.zenjoymedia.media
       service: http://localhost:5201
     # ... 现有 autopilot 等规则 ...
     - service: http_status:404
   ```
   并加 DNS：`cloudflared tunnel route dns <tunnel-name> staging.zenjoymedia.media`
   （或在 Cloudflare DNS 后台加 CNAME → `<tunnel-id>.cfargotunnel.com`，Proxied 橙云）。
   重启 cloudflared 使生效。

2. **建 Access 应用（Cloudflare Zero Trust 后台，用户操作）**
   Zero Trust → Access → Applications → Add application → Self-hosted：
   - Application name: `ZenithJoy Staging`
   - Application domain: `staging.zenjoymedia.media`
   - Session duration: 24h（按需）

3. **建 Access 策略 = 邮箱白名单闸（用户操作，邮箱待提供）**
   Policy name: `staging-allow-whitelist`，Action: `Allow`，Include 任选：
   - **Emails**：`<TODO: 待用户提供白名单邮箱，逗号分隔>`
   - 或 **Emails ending in**：`@<TODO: 公司域名，如 zenjoymedia.media>`
   - 或 **Login methods**：Google（配合上面的邮箱/域名收紧）
   登录方式：开 One-time PIN（邮箱收验证码）或接 Google OAuth。

4. **验证**
   未登录浏览器开 `https://staging.zenjoymedia.media` → 应被 Cloudflare Access 拦到登录页；
   用白名单邮箱过验证码/Google 登录 → 进到 staging dashboard；非白名单邮箱应被拒。

> 待用户给：① 白名单邮箱清单 ② 确认用 OTP 还是 Google ③ 用户在 Zero Trust 后台点建应用+策略。

---

## 人工验证 instruction（放行前必走）

打开 staging（道一 `http://perfect21:5201` 或道二 `https://staging.zenjoymedia.media`），
确认下列都 OK，再去 Actions 手点 `promote-prod.yml`（confirm 框输入 `PROMOTE`）：

| 步骤 | 操作 | 应看到 |
|---|---|---|
| X | 开 `…/health` | `ok`（200） |
| Y | 开 `…/version` | `sha` = 本次候选 commit（与你要放行的一致） |
| Z | 开 staging dashboard 首页，走本次 PR 改动相关的页面/动作 | 改动生效、无报错、无白屏；本次 PR 描述里声明的「应看到的变化」真出现 |

任一不对 → 不要 promote，回去修。staging 连的是 `zenithjoy_test` 库，随便点不影响客户。
