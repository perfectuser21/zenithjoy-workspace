# SQLite → Postgres Cutover SOP

> 彻底重构 PR-d/5 — 由主理人在 PR 合并后手动执行一次，把 SQLite 里的历史 topics 搬到 Postgres，并冻结 SQLite 侧。

## 背景与前置

- PR-a/b/c 已合并并运行稳定：apps/api 新端点、creator-api 转发、workers HTTP 化。
- Postgres `zenithjoy.topics` 已有 ≥1 行（PR-b 冒烟测试）。
- SQLite `services/creator/data/creator.db` 仍有 1 条龙虾（id=`f108b4d8-244e-4663-bcf6-2e7816ab00fe`, status=研究中），以及 `pacing_config.daily_limit=1`（已与 Postgres seed 等值，暂不迁移）。
- 业务代码已不再读 SQLite（workers 走 HTTP，creator-api 走 Postgres），但 SQLite 文件仍在原位作为兜底。

本次 cutover 做两件事：
1. 运行 `scripts/migrate-sqlite-to-pg.py --apply --backup-first` 把 SQLite topics 搬到 Postgres。
2. 运行 `services/creator/migrations/999_freeze_sqlite.sql` 冻结 SQLite（表改名 + 建空 view），防止任何遗漏的读路径误用老数据。

## 时间窗口

推荐 09:30 CST（topic-worker 09:00 执行完 30min 之后）。避免 09:00 cron 碰撞。

## Cutover 步骤

### 1. 拉主分支

```bash
cd /Users/administrator/perfect21/zenithjoy
git pull origin main
```

### 2. 预检（dry-run）

```bash
python3 scripts/migrate-sqlite-to-pg.py --dry-run
```

预期输出（示意）：
```
[SQLite] topics 总数: 1
[Postgres] zenithjoy.topics 现有: 1
  已存在 id: e5d9d8c0-331f-4dd7-92f9-dde8105ebd4c
[PLAN] 将插入 1 行，跳过 0 行（已存在）
将插入：
  - id=f108b4d8-244e-4663-bcf6-2e7816ab00fe | status=研究中 | title=为什么 2026 年龙虾 让一人公司成为为了可能
```

若 `将插入` 为 0（已迁过），说明 cutover 已经做过，直接跳到步骤 5 执行 freeze。

### 3. 真迁移（含备份）

```bash
python3 scripts/migrate-sqlite-to-pg.py --apply --backup-first
```

脚本会：
- 先把 `services/creator/data/creator.db` 复制到 `services/creator/data/backups/creator.db.bak-<UTC 时间戳>`（含 -wal / -shm 附属文件）。
- 用 `psql` 执行 `INSERT ... ON CONFLICT (id) DO NOTHING` 逐行插入。
- 结尾打印迁移前后 count + 龙虾校验（id=f108b4d8…00fe 在 Postgres 应为 1 行）。

退出码 0 = 全部成功；非 0 = 有行失败（看终端输出里的 `[FAIL]`）。

### 4. 验证 Postgres 数据

```bash
psql -U cecelia -d cecelia -h localhost -p 5432 -c \
  "SELECT id, title, status FROM zenithjoy.topics ORDER BY created_at;"
```

应看到至少 2 行（龙虾 + PR-b 冒烟测试）。

### 5. 冻结 SQLite

```bash
sqlite3 services/creator/data/creator.db < services/creator/migrations/999_freeze_sqlite.sql
```

执行后：
- `topics` 表被 rename 为 `topics_frozen_20260416`（业务数据保留）。
- 同名 view `topics` 永远返回空行；任何 INSERT/UPDATE 会直接报错（SQLite view 默认只读）。

验证：
```bash
sqlite3 services/creator/data/creator.db "SELECT COUNT(*) FROM topics;"
# 预期输出：0

sqlite3 services/creator/data/creator.db "SELECT COUNT(*) FROM topics_frozen_20260416;"
# 预期输出：1（原业务数据保留）
```

### 6. 端到端冒烟

主理人在 Dashboard 手动新增一条 topic（或通过 API）：

```bash
curl -X POST http://localhost:8899/api/topics \
  -H 'Content-Type: application/json' \
  -d '{"title":"PR-d cutover 冒烟","priority":1}'
```

验证只落到 Postgres，不落 SQLite：

```bash
psql -U cecelia -d cecelia -h localhost -tAc \
  "SELECT COUNT(*) FROM zenithjoy.topics WHERE title='PR-d cutover 冒烟';"
# 预期：1

sqlite3 services/creator/data/creator.db \
  "SELECT COUNT(*) FROM topics WHERE title='PR-d cutover 冒烟';"
# 预期：0（view 永远返回空）
```

### 7. 可选：观察 workers

```bash
tail -f /tmp/pipeline-worker.log /tmp/topic-worker.log
```

下一轮 pipeline-worker 轮询（60s 内）应仍能从 apps/api `/api/pipelines/running` 拿到待处理的 pipeline，topic-worker 明天 09:00 执行时从 Postgres 读选题。

## 回滚步骤

### 回滚触发条件

- 步骤 3 迁移脚本报错，且数据疑似不一致
- 步骤 6 冒烟发现 Dashboard 读/写异常
- 合并后 24h 内出现明确的数据可见性问题

### 回滚方法 A：仅 Postgres 侧（数据层回退，保留代码）

```bash
# 1. 备份当前 Postgres（防回滚二次丢失）
pg_dump -U cecelia -d cecelia -h localhost -p 5432 -n zenithjoy \
  -f /tmp/zenithjoy-rollback-$(date +%Y%m%d-%H%M%S).sql

# 2. 回退 SQLite freeze（若已执行）
sqlite3 services/creator/data/creator.db <<'SQL'
BEGIN;
DROP VIEW IF EXISTS topics;
ALTER TABLE topics_frozen_20260416 RENAME TO topics;
COMMIT;
SQL

# 3. 从 Postgres 删除刚迁入的龙虾（若需要还原 PR-b 单行状态）
psql -U cecelia -d cecelia -h localhost -p 5432 -c \
  "DELETE FROM zenithjoy.topics WHERE id = 'f108b4d8-244e-4663-bcf6-2e7816ab00fe';"
```

### 回滚方法 B：SQLite 文件整体还原

```bash
# 找最近的备份
ls -lt services/creator/data/backups/creator.db.bak-*

# 停 workers（防半途写）
launchctl unload ~/Library/LaunchAgents/com.zenithjoy.pipeline-worker.plist
launchctl unload ~/Library/LaunchAgents/com.zenithjoy.topic-worker.plist

# 还原（注意：此时 creator-api/workers 已不读 SQLite，此步骤主要用于恢复备份文件）
cp services/creator/data/backups/creator.db.bak-<ts> \
   services/creator/data/creator.db

# 启 workers
launchctl load ~/Library/LaunchAgents/com.zenithjoy.pipeline-worker.plist
launchctl load ~/Library/LaunchAgents/com.zenithjoy.topic-worker.plist
```

### 完整回滚（代码层一并 revert）

若 PR-b/c 也需要 revert 回 SQLite 读路径：

```bash
git revert <pr-d-commit> <pr-c-commit> <pr-b-commit>
git push origin main
# 按 04-migration-steps.md § 回滚 重启 apps/api + creator-api + workers
```

**RTO**：方法 A ≈ 5min；方法 B ≈ 10min；完整回滚 ≈ 20min。

## Cutover 后维护

| 时间 | 动作 |
|------|------|
| T+0 | 本 SOP 步骤 1–7 完成，保留备份文件 |
| T+2d | PR-e 合并，彻底删除 SQLite 相关代码 |
| T+7d | 把 `services/creator/data/backups/creator.db.bak-*` 移到 `~/backups/` 冷存储 |
| T+30d | 物理删除备份文件 |

## 附：脚本常用参数

```
--sqlite <path>          SQLite creator.db 路径（默认 services/creator/data/creator.db）
--pg-host / --pg-port    Postgres 连接（默认从 apps/api/.env 读）
--pg-user / --pg-db      同上
--backup-dir <path>      备份存放目录（默认 services/creator/data/backups）
--env-file <path>        自定义 .env 文件（默认 apps/api/.env）

--dry-run                只打印，不写（默认）
--apply                  真执行
--backup-first           配合 --apply：先备份 SQLite 再迁移
```

## 参考

- `/tmp/pipeline-migration-plan/04-migration-steps.md` § T+2.5d PR-d cutover
- `/tmp/pipeline-migration-plan/06-pr-breakdown.md` § PR-d
- `apps/api/db/migrations/20260416_163600_create_zenithjoy_topics.sql`（Postgres schema）
- `services/creator/migrations/001_create_topics.sql`（SQLite 源 schema）
