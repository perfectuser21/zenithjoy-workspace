# 小改动 PrepPRD：微信客服 CRM 采集对账 + 清存量

Journey：ZenithJoy 客户管理（Line 04，id e6270293-7ca3-4261-b01d-4de4c66e0352）。全程纯 API 侧，不动 agent、不碰版本闸。

## 改什么
1. 新 migration：`zenithjoy.crm_customers` 加两列
   - `deleted_at timestamptz`（软删，NULL=在册）
   - `scan_miss_count int NOT NULL DEFAULT 0`（连续未扫到计数）
2. ingest 对账（POST /api/crm/friend-scan/ingest，upsert 之后，同一事务内）：
   - 本次扫到的 contact → scan_miss_count=0 + deleted_at=NULL（重现即复活）
   - 本次没扫到的 source='scan' 行 → scan_miss_count += 1；达到 K=3 → 真模式 deleted_at=now()；
     干跑模式只打日志「本应软删 X」，不写 deleted_at（但仍累计 miss_count 以便观测收敛）
   - 干跑开关 env CRM_RECONCILE_DRYRUN，默认 'true'（到处安全）；staging 设 'false' 实测软删
   - 对账只作用于 source='scan'；manual/message 行不参与（永不被扫描对账删）
3. GET /api/crm/customers 查询加 `AND deleted_at IS NULL`
4. self / ClawBot：
   - 常量 DEFAULT_BLACKLIST_NAMES（含 '微信ClawBot'）→ ingest INSERT 时 identity='blacklist'；
     ON CONFLICT 不覆盖人工已设 identity
   - ingest 新增可选入参 self_name：匹配则整条 contact 不入册（向前兼容，agent 不传=无影响）
5. 清 64 旧群：一次性 SQL 把 staging zenithjoy_test 里旧群条目软删（deleted_at=now()），可恢复

## 为什么改
real-wheel 全扫已稳（PR#897-903），但 ingest 只增不删 → 修复前扫进的 64 个旧群残留在册；
名册需对账收敛。破坏性逻辑必须带护栏：软删 + 连续 K 次 + 默认干跑。

## 关联上下文
- handoff：sprints/06251435-wechat-cs-crm-build/handoff-2-scan-done-next.md 第二节
- 决策默认（lead 2026-06-26）：K=3 / 干跑默认 ON / self 用 self_name 入参（不强制改 agent）/ 清 64 用软删

## 影响范围
- 纯 apps/api（migration + crm.ts），不动 agent，无版本面同步
- GET /customers 多一个 WHERE，软删行消失；manual 客户不受影响

## 验收标准
- [ ] vitest：对账三态（扫到复活 / 未扫到累计 / 满 K 软删）、干跑只日志不删、GET 排除软删、ClawBot 默认黑名单
- [ ] CI 全绿
- [ ] staging dryrun=false 跑一次 force-scan：旧群软删、18 真客户留存、ClawBot 标黑、名册干净
