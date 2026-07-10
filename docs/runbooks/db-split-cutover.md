# 拆库刀1 切换 Runbook：zenithjoy schema → 独立 zenithjoy 库

> 决策 0710 环境隔离 · Brain task 2b557dca · 前置 PR：cecelia#3701（Brain 独立池）+ 本 PR（deploy 链 var 开关）
> **执行人：用户在场（生产切换）。预计停写窗口 < 2 分钟（schema 仅 ~10 MB）。**

## 前置状态核对（切换前，任一不满足即停）

- [ ] cecelia#3701 已合并且 Brain 生产 ≥1.244.2（`docker exec cecelia-node-brain sh -c 'ls /app/src/zenithjoy-db.js'` 存在）
- [ ] 本 PR 已合并（promote/rollback workflows 认 `vars.ZJ_PROD_DB`）
- [ ] `zenithjoy` 空库已建（2026-07-10 已建，owner=cecelia）：`psql -U postgres -qAtc "SELECT 1 FROM pg_database WHERE datname='zenithjoy'"`
- [ ] 当晚无 pipeline 在跑发布任务（`curl -s localhost:5221/api/brain/tasks?status=in_progress | grep content_publish` 为空）

## 切换步骤（按序，每步有验证）

1. **全量迁移数据**（幂等，可提前预跑+切换时增量重跑）：
   ```bash
   pg_dump -h localhost -U postgres -d cecelia -n zenithjoy | psql -h localhost -U postgres -d zenithjoy
   # 验证：两边行数抽查
   for t in works publish_logs tenants agents licenses; do
     echo "$t: $(psql -U postgres -d cecelia -qAtc "SELECT count(*) FROM zenithjoy.$t") vs $(psql -U postgres -d zenithjoy -qAtc "SELECT count(*) FROM zenithjoy.$t")"
   done
   ```
   注意：新库内仍保留 `zenithjoy` schema 名（API 全部 SQL 写死 `zenithjoy.` 前缀，不改代码）。
2. **翻 GitHub repo variable**：`gh variable set ZJ_PROD_DB --body zenithjoy --repo perfectuser21/zenithjoy-workspace`
3. **改生产 plist 运行库**（与第 2 步必须同日同翻，否则 migration/runtime 分裂）：
   编辑 `~/Library/LaunchAgents/com.zenithjoy.api.plist` 的 `DATABASE_NAME` → `zenithjoy`，然后
   `launchctl bootout gui/$(id -u)/com.zenithjoy.api; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zenithjoy.api.plist; launchctl kickstart -k gui/$(id -u)/com.zenithjoy.api`
   ⚠️ 绝不碰无 `.staging` 后缀以外的其他 label；参考 memory「误 unload 生产 plist 会摘 launchd 管理」教训。
4. **Brain 容器加 env**：cecelia-deploy-main 的 compose env 加 `ZENITHJOY_DB_NAME=zenithjoy`（⚠️ env 名以 cecelia repo `zenithjoy-db.js` 为准，是 `ZENITHJOY_DB_*` 不是 DATABASE_*），重启 `cecelia-node-brain`。
5. **验证**：
   - `curl -s localhost:5200/health` 200 + `/version` 命中当前 sha
   - 发布回执冒烟：跑一条 dryrun content_publish，确认 `zenithjoy` 库 `publish_logs` 新增行、`cecelia` 库旧 schema **无**新增行
   - `bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh`（若适用）
6. **冻结旧 schema**（观察一周，期间任何进程再写旧库会立刻报错暴露漏网者）：
   ```bash
   psql -U postgres -d cecelia -c "ALTER SCHEMA zenithjoy RENAME TO zenithjoy_frozen_20260710"
   ```
7. **一周后删除**：`DROP SCHEMA zenithjoy_frozen_20260710 CASCADE`（删前再备份一份 dump）。

## 回滚（任一步失败）

- 第 2 步回滚：`gh variable set ZJ_PROD_DB --body cecelia ...`
- 第 3 步回滚：plist DATABASE_NAME 改回 cecelia + 同款 bootout/bootstrap/kickstart
- 第 4 步回滚：去掉 `ZENITHJOY_DB_NAME` env 重启 Brain
- 第 6 步回滚：`ALTER SCHEMA zenithjoy_frozen_20260710 RENAME TO zenithjoy`
- 数据不回迁：冻结前旧 schema 一直是完整副本，新库切换后产生的增量在回滚时需人工评估（窗口内通常为零）。

## 切换后待改清单（非阻塞，一周观察期内完成）

- `scripts/sync-scraper-to-works.sh:28` / `scripts/publish-by-content-id.sh:27`：`PGDATABASE` 默认值 cecelia → zenithjoy
- `scripts/audit-content-pipeline.sh:37-40`：硬编码 `-d cecelia` → zenithjoy
- n8n「数据采集调度器」：Postgres 凭据目标库 cecelia → zenithjoy
- cecelia repo `backfill-publish-logs.js`：补 `zjPool.end()`（退出多挂 30s 的 Minor）
- CI 若跨库假设报错（cross-line 等 workflow 一次性容器内建库），按报错逐个对齐
