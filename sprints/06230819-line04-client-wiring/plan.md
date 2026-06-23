# Line04 客户机接线 — 把每客服配置土台接到真机上

> 直接 /dev（不走 full harness），分 commit TDD。真发那关走 xian-rog 手动真机验收（CI 不可达）。
> 承接 PR #825（中台侧土台已 merge+prod 验）+ 决策 cebce4a2 / 143f5d00 / 04c34b86。

## 身份链路（已查实）
- `agents`(id uuid, agent_id text env-id 唯一, hostname...) — **无 machine_id 列**
- `service_agents`(tenant_id, member_user_id, machine_id, deleted_at) — 客服-PC 绑定（admin 前台管的就是这张）
- agent 注册 `POST /api/agent`：带 `{license_key, machine_id, agent_id, version}`
- **唯一通用 join 键 = machine_id**（agent 持有 + service_agents 持有；agents.id 那个 UUID 与 service_agents 无直接链）
- 故客户机按 **machine_id** 拉自己那份（不靠 RPA 读真实微信号；agent_id 单独解不到 wechat_id）

## Commit 拆解

### commit 1（中台，CI 可测）— 绑定 + 按 machine_id 拉
1. migration：`ALTER TABLE zenithjoy.service_agents ADD COLUMN wechat_id text`（可空；admin 前台手填）
2. store `cs-account-config-store.ts`：`getCSConfigByMachine(machineId)` → `SELECT wechat_id FROM service_agents WHERE machine_id=$1 AND deleted_at IS NULL` → `getCSConfig(wechat_id)`；无绑定/无 wechat_id → null
3. 端点 `GET /cs/agent-config` 增收 `machine_id`：解析 → 命中返回 `{wechat_id, ...config}`；未绑定/未注册 → 403 + recordIdentityAlert + 不泄漏 persona（沿用现有）
4. 单测：machine_id→config 解析；未绑定 machine_id → null/403；保留 wechat_id 直拉路径

### commit 2（前台）— admin 填微信号
- 客户管理页/PerCsConfigPage：客服绑定处加「微信号」输入 → 写 service_agents.wechat_id（= 该客服配置 key）
- 一处设：微信号 + 人设/白名单/营业时间/关键人/auto_agent 开关

### commit 3（客户机 python）— 拉自己那份 + gate
1. Node `handlers/wechat-rpa.js` `buildListenerSpawnArgs`：追加 `--machine-id <id>`（Node/core 有 machine_id）
2. `listen_chat.py`：parse `--machine-id`；主循环每 N 轮 `GET /cs/agent-config?machine_id=自己` → 缓存
3. port gate 到 Python `cs_config_gate.py`（resolveSendMode/resolveActiveConfig/shouldReply，对齐 cs-config-gate.js）+ Python 单测
4. 真发判定改：跟随该客服 `auto_agent_enabled`（拉成功且 ON→真发；OFF 或拉失败→dryrun 用缓存）；白名单用 config.whitelist；保留 env 作开发兜底
5. 软校验：读昵称 best-effort 上报；身份不符 → 上报诊断（不阻塞）

### commit 4 — module bump
- `manifest.json` 1.0.55 → 1.0.56；rebuild 模块
- ops：service_agents 给 xian-rog 现客服那行填真微信号（或前台设），把 wxid_legacy_global 那份内容搬过去

## 真机验收（xian-rog 手动，非 CI）
- 前台给 xian-rog 客服填微信号 + auto_agent ON → 客户机拉到 ON → 默忆私聊 → 真发 + 读回送达
- auto_agent OFF → 下一轮 dryrun（不真发）
- 中台不可达 → 用缓存 + dryrun（绝不误真发）

## 验收标准（CI 可达）
- [ ] 后端：machine_id→该客服 config（萌萌/天下第一 两机各拉各的不串）；未绑 machine_id→403
- [ ] Python gate：ON+pullOk→real / OFF→dryrun / pullOk=false→dryrun / 白名单
- [ ] CI 全绿
