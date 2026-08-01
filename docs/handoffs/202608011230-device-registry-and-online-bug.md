# Handoff：设备登记进 Cecelia 注册表 + 发现在线状态恒为 false 的真 bug

- task_id: unknown（交互式运维）
- journey_id: 无（基建）
- verdict: PASS（登记完成）＋ 发现 1 个待修 bug
- created_at: 2026-08-01T04:30:00.000Z
- 前置：见 `202608011100-test-device-fleet-infra.md`（设备接入过程 + 踩坑）

## 背景

用户问"我们不是有个设备管理页面吗，把新设备加进去了没"。排查后澄清了一个长期混淆点，
并把这两天新接入的设备补登记，过程中发现一个真 bug。

## 关键澄清：有两套"机器管理"，别混

| | ZenithJoy `apps/dashboard` | **Cecelia `system_registry`** |
|---|---|---|
| 页面 | `MachineManagementPage.tsx` | `frontend/src/features/core/system/pages/MachinesPage.tsx` |
| 给谁 | **客户**——看自己 license 绑了哪几台机、机上登了哪些抖音号 | **我们自己**——内部基建台账 |
| 数据 | `license_machines` 表（按租户/license 隔离） | `system_registry` 表（`type='machine'`） |
| 内容 | 客户的机器 | NAS / VPS / Mac / 测试PC / 测试手机 |

> 用户记忆中"能看到自己机器（NAS、VPS）的地方"= **Cecelia 那个**，不是 ZenithJoy 客户端那个。
> 内部测试设备**不能**塞进客户端页面（按 license 隔离，会污染客户视图）。

## 完成

### 设备登记：9 台 → 15 台
新增 6 台（`POST /api/brain/machines` 等价的直接 SQL 插 `system_registry`）：
- `xian-pc2`（2号机，status=**inactive**，注明 sshd 起不来的完整排查结论）
- `xian-pc3`（3号机，i3-7100/8GB，SSH 上机实查的真实配置）
- `xian-pc4`（4号机，i5-9600KF/8GB，含 runner 服务名 + 手机池守护）
- `android-xiaohuang`（小黄，status=**inactive**，注明卡在锁屏 BFU）
- `android-xiaobai`（小白）、`android-xiaofen`（小粉）——含 ADB 序列号、端口、已做的加固

校正 2 台过时描述：
- `xian-rog`：原"Windows RPA 备用机" → 实为**唯一微信 CI runner**，并注明"与手机池不同网段够不到手机，安卓E2E不该挂它"
- `xian-5060`：补上它同时是测试PC 5号机

metadata 字段结构照抄已有记录（os/cpu/memory/role/tags/ssh_alias/tailscale_ip/tailscale_name/
services/accounts/deprecated/physical_location/effective_country/offers_exit_node/exit_node/notes）。

## 🔴 发现的 bug：`tailscale_online` 恒为 false（待修）

**现象**：`GET /api/brain/machines` 返回的 15 台**全部** `tailscale_online: false`，
包括确定在线的 vps-hk、4号机。页面上等于所有机器永远显示离线。

**根因链**（已定位到具体路径，不是猜测）：
1. `packages/brain/src/routes/machines.js:26` —— `TAILSCALE_CACHE = join(REPO_ROOT, 'tailscale-cache.json')`
2. Brain 容器（`cecelia-node-brain-green` 等 4 个）里 `REPO_ROOT=/Users/administrator/perfect21/cecelia-deploy-main`
3. 但写缓存的 crontab 写的是另一个路径：
   ```
   * * * * * /opt/homebrew/bin/tailscale status --json > /Users/administrator/perfect21/cecelia/tailscale-cache.json
   ```
4. **`cecelia-deploy-main/` 下根本没有这个文件** → `existsSync` false → 回落到 `execSync('tailscale status')`
   → 容器内没有 tailscale CLI → catch 返回 `{}` → 所有机器查不到 → 恒 false

**已验证不是数据问题**：缓存文件本身是新鲜的（每分钟更新）且内容正确——
`WIN-20250108FHG` 明确 `Online: True`，IP `100.100.238.25` 与登记值一致；解析逻辑也正确。
纯粹是**两个路径对不上**。

**修法（三选一，建议 A）**：
- **A. 让 crontab 同时写一份到 deploy 路径**（改动最小，一行 cron）
- B. 给 Brain 容器挂载宿主机缓存文件到 `$REPO_ROOT/tailscale-cache.json`
- C. 代码里加多路径 fallback（`REPO_ROOT` + 硬编码 `~/perfect21/cecelia/`）

修完验收：`curl localhost:5221/api/brain/machines | jq '.[] | select(.name=="xian-pc4") | .tailscale_online'` → 应为 `true`

## 未完成

1. **上面那个 bug 没修**（本次只定位，未动代码——属改 Cecelia 仓库，应走 /dev）
2. **status 字段仍是手填静态值**：我填的 `active`/`inactive` 不会自己变。
   小黄恢复后不会自动转 active。修完 bug 后可考虑让 status 由 `tailscale_online` 推导，
   或保留 status 表达"是否纳入使用"、用 tailscale_online 表达"此刻是否在线"（建议后者，语义更清晰）
3. **安卓在线状态不该只看 Tailscale**：手机可能 Tailscale 在线但 Agent 没跑（今天实测遇到过）。
   真实可用性 = Tailscale 在线 **且** `agents` 表（`zenithjoy_staging` 库）心跳新鲜。
   建议 enrich 时对 `tags` 含 `test-phone` 的补一路心跳查询
4. **CI runner 状态没进页面**：`gh api repos/perfectuser21/zenithjoy-workspace/actions/runners`
   可查两个 runner 在线与否，建议一并纳入

## 下一步建议顺序

1. 修 `tailscale_online` 路径 bug（A 方案，最小改动，立刻让页面有真实数据）
2. 安卓心跳补充进 enrich（让"手机可用"判断准确）
3. runner 状态纳入
4. 再考虑 status 语义调整

## 数据源

- 表：Cecelia `system_registry`（`type='machine'`），Brain DB（localhost:5432/cecelia）
- 后端：`packages/brain/src/routes/machines.js`（`getTailscaleStatus` / `enrichMachine`）
- 前端：`frontend/src/features/core/system/pages/MachinesPage.tsx`
- 缓存写入：crontab 每分钟 → `~/perfect21/cecelia/tailscale-cache.json`
- 手机心跳：`zenithjoy_staging` 库 `agents` 表（**不是** `zenithjoy` 生产库）
- 设备操作细节/踩坑：memory `machines.md`

## 产物

- 无 PR（本次只写 DB + 定位 bug，未改代码）
- `system_registry` 新增 6 条、更新 2 条
