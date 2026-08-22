# 小改动 PrepPRD：dm_per_hour 5→20、发送间隔 300-900s→120-180s

## 改什么
`apps/api/src/services/acquisition-dispatch.ts` 的 `defaultConfig()`：
- `dm_per_hour: 5` → `20`
- `dm_interval_min_sec: 300` → `120`
- `dm_interval_max_sec: 900` → `180`

新增一条 SQL migration：
1. `ALTER TABLE zenithjoy.acquisition_config ALTER COLUMN dm_per_hour SET DEFAULT 20` （同 interval 两列）
2. `UPDATE` 仍停在旧默认值（`dm_per_hour=5 AND dm_interval_min_sec=300 AND dm_interval_max_sec=900`）的既有租户行，同步刷到新值——**不碰任何已经被手动 PUT /config 自定义过的租户**（用旧默认三元组做 WHERE 条件天然排除掉这些行）。

## 为什么改
主理人 0821 深夜拍板：现有 `dm_per_hour=5` 是团队自己拍的保守值，把交付冲刺重投出来的候选大量卡成 `limited`（33/35）。主理人明确：调到 20，发送间隔从 5-15 分钟改成 2-3 分钟随机（不要固定间隔，要保留随机性）。

## 关联上下文
- 相关 Journey：Line02 智能获客（`line02/keyword_acquisition`）
- 相关 handoff：`docs/handoffs/202608212130-line02-acquisition-delivery-push.md`
- 相关代码：本会话早些时候刚合并的 PR#1695（`clampToWindowStart` 排期越窗 bug 修复），本次改动与其独立、互不冲突
- Brain 决策：本次对话内 `dm_per_hour` 相关拍板未走 decisions 表单独登记（属参数调整，走本 PrepPRD 落地即视为拍板记录）

## 影响范围
- 影响所有走 `getConfig()` 默认值路径的新租户（还没 PUT 过 /config 的）
- 影响所有当前仍停在旧默认三元组的既有租户（含真机在跑的 `realmachine-smoke` 租户 455a8ca9）——这正是主理人想要生效的对象
- 不影响任何已手动自定义过频控参数的租户
- `CONFIG_RANGES`（`dm_per_hour: [1,100]`、`dm_interval_min_sec/max_sec: [1,86400]`）无需改动，20 和 120-180 都在合法区间内
- Dashboard UI（`AcquisitionConfigPage.tsx` 的 `dm_per_hour` 输入框 `max:60`）无需改动，20 在范围内

## 验收标准
- [ ] `defaultConfig()` 三个字段值改对，既有单测（`dm_per_hour / dm_per_day 有合理默认值`、`dm_interval_min_sec <= dm_interval_max_sec`）仍通过
- [ ] migration 在本地/CI 跑一遍确认：新租户 insert 走列默认值拿到 20/120/180；旧默认三元组的既有行被 UPDATE 到新值；手动自定义过的行不受影响（写一个小场景验证）
- [ ] CI 全绿
