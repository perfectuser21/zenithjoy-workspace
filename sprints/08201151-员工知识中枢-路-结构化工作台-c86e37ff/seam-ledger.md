# 接缝台账 —— 路③ Sprint A（INV-6 [真环境验证才算done] 的判据载体）

状态只许三种取值，`--inv-seam-ledger` 逐行机械校验：

- `done` —— 已在真目标上验过，有可复现的证据命令
- `logic-done-pending` —— 逻辑写完但尚未在真目标上验过，**不得标 done**
- `logic-done-pending-offsite` —— 同上，且挂起原因是异地/生产侧依赖（合同已登记）

| # | 接缝 | 真目标验证方式 | 状态 |
|---|------|----------------|------|
| S1 | 会话 → 组织归属（better-auth 真会话 + `tenant_members` 真表） | `structured-workbench-smoke.sh --a1-a3-only`：真起 apps/api + 真 PG 双企业种子，A1 反向与 A3 正向同一次运行内成对执行 | done |
| S2 | 五张新表的 DDL 与软删语义 | `--a10-only`（建表前后 `information_schema` 快照全等）+ `--a9-only`（`deleted_at` 非空而物理行不减）；migration 本地重放两次幂等 | done |
| S3 | 员工在真浏览器里建表/删表/还原 | `e2e-knowledge-hub-path3.yml` 的 `windows-real-browser` job `conclusion == success`（判据是 job 真跑过，不是文件存在） | done |
| S4 | 给 `/api/fields` 挂鉴权后 dashboard 是否被打断腿 | 同一 workflow 内 `apps/dashboard/e2e/fields-auth-regression.spec.ts` 真浏览器带真会话跑，业务代码零改动 | done |
| S5 | 备份产物能不能还原 | `restore-drill.sh`：真 `pg_dump` → 真 `pg_restore` 到临时库 → 五表 count 全等 + 关键字段 md5 全等 + 标记行逐字相同 | logic-done-pending-offsite |

## S3/S4 翻成 done 的依据

两者的真目标都是 `windows-latest` 干净 VM 上的真浏览器。翻牌条件是"PR 上的 workflow 真跑过、
且那个 windows job 的 `conclusion == success`"——本地跑绿、workflow 文件写好都不算，
A33 的判据在 v3 已经从 `on:` 块修正到 job 级运行结果，理由就是"静态形状为真、job 却从没运行"
这种孤儿 spec 形态。

该条件已在本 PR 上满足：`e2e-knowledge-hub-path3.yml` 在分支上真跑过，
`windows-real-browser` job `conclusion == success`，其中
`structured-workbench.spec.ts`（路③ Golden Path 全链 + 五张截图）与
`fields-auth-regression.spec.ts`（A4④ dashboard 回归）都真执行且通过。
DoD 里那条运行时判据（`gh run view --json jobs | jq '…windows…success…'`）自跑返回 `true`。

## 为什么 S5 是 offsite

`pg_dump` 与恢复演练这两件本身是真跑真验的（不是 mock）。挂起的只有"异地"那一半：
备份目前落 GHA artifact（14 天），真正的异地对象存储需要 `COS_SECRET_ID` / `COS_SECRET_KEY`
两个仓库 secret，当前 repo 未配置且本刀无权设置。配好后由 Sprint B 补 upload step，
并把 A5 断言扩展到"从 COS 拉回的备份还原全等"。
