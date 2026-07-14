# ZenithJoy staging独立库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ZenithJoy staging 后端（5201端口）从借用 `zenithjoy_test` 库切到真正独立的 `zenithjoy_staging` 库。

**Architecture:** 新增一次性运维脚本 `scripts/create-staging-db.sh`（建库→跑migration→校验→备份plist→改DATABASE_NAME→重启→health check，失败自动回滚plist）。

**Tech Stack:** bash + psql/createdb + npm(ts-node) migration runner + plutil + launchctl

---

### Task 1: 新增建库执行脚本

**Files:**
- Create: `scripts/create-staging-db.sh`

- [ ] **Step 1: 写脚本**

```bash
cat > scripts/create-staging-db.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
# create-staging-db.sh — ZenithJoy staging建真正独立库
#
# 背景：staging后端(5201端口)目前DATABASE_NAME=zenithjoy_test借用测试库，
# 不是真正独立的staging库。本脚本新建zenithjoy_staging库，跑全量migration，
# 切换staging plist的DATABASE_NAME，重启验证health。
# 决策依据：decision d76d715b
#
# 用法：bash scripts/create-staging-db.sh
# 前提：本机可直连localhost postgres；本脚本依赖本机psql/createdb默认认证方式
# （.pgpass或本地peer/trust认证），不显式传密码。
#
# 若中途失败：迁移步骤本身幂等可安全重跑；plist改动前有自动回滚保护，
# 不会让staging长期停服。

set -euo pipefail

DB_NAME="zenithjoy_staging"
REF_DB="zenithjoy"
PLIST="$HOME/Library/LaunchAgents/com.zenithjoy.api.staging.plist"
PLIST_LABEL="com.zenithjoy.api.staging"
HEALTH_URL="http://localhost:5201/health"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/api"

echo "=== Step 1: 建库 $DB_NAME（幂等） ==="
EXISTS=$(psql -h localhost -U cecelia -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME';" -d postgres | tr -d ' ')
if [ "$EXISTS" = "1" ]; then
  echo "  ℹ️  $DB_NAME 已存在，跳过建库"
else
  createdb -h localhost -U cecelia "$DB_NAME"
  echo "  ✅ 已建库 $DB_NAME"
fi

echo ""
echo "=== Step 2: 跑全量migration（显式传DATABASE_*，避免落到run-migration.ts默认值cecelia库） ==="
(
  cd "$API_DIR"
  DATABASE_HOST=localhost \
  DATABASE_PORT=5432 \
  DATABASE_NAME="$DB_NAME" \
  DATABASE_USER=cecelia \
  npm run migrate
)
echo "  ✅ migration执行完成"

echo ""
echo "=== Step 3: 校验migration行数与独立zenithjoy库一致 ==="
STAGING_COUNT=$(psql -h localhost -U cecelia -d "$DB_NAME" -tc "SELECT count(*) FROM zenithjoy.schema_migrations;" | tr -d ' ')
REF_COUNT=$(psql -h localhost -U cecelia -d "$REF_DB" -tc "SELECT count(*) FROM zenithjoy.schema_migrations;" | tr -d ' ')
if [ "$STAGING_COUNT" != "$REF_COUNT" ]; then
  echo "  ❌ migration行数不一致: ${DB_NAME}=${STAGING_COUNT} ${REF_DB}=${REF_COUNT}，中止（未改plist）"
  exit 1
fi
echo "  ✅ migration行数一致: ${STAGING_COUNT}"

echo ""
echo "=== Step 4: 备份当前staging plist ==="
BACKUP_PLIST="${PLIST}.bak.$(date +%s)"
cp "$PLIST" "$BACKUP_PLIST"
echo "  ✅ 备份到 ${BACKUP_PLIST}"

echo ""
echo "=== Step 5: 切换DATABASE_NAME ==="
plutil -replace EnvironmentVariables.DATABASE_NAME -string "$DB_NAME" "$PLIST"
echo "  ✅ DATABASE_NAME 已改为 $DB_NAME"

echo ""
echo "=== Step 6: 重启staging服务 ==="
launchctl unload "$PLIST" 2>/dev/null || true
sleep 1
launchctl load "$PLIST"
echo "  ✅ 服务已重启"

echo ""
echo "=== Step 7: health check 轮询 ==="
HEALTHY=false
for i in $(seq 1 12); do
  STATUS=$(curl -sf --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ok" ]; then
    HEALTHY=true
    break
  fi
  echo "  尝试 $i/12: status=${STATUS}，等待..."
  sleep 10
done

if [ "$HEALTHY" = "true" ]; then
  echo ""
  echo "✅ staging已切到独立库 ${DB_NAME}，health check通过"
  exit 0
else
  echo ""
  echo "❌ health check失败，自动回滚plist到迁移前状态"
  cp "$BACKUP_PLIST" "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  sleep 1
  launchctl load "$PLIST"
  echo "  已回滚并重启，staging应恢复到旧库(zenithjoy_test)状态，请人工排查${DB_NAME}问题"
  exit 1
fi
SCRIPT_EOF
chmod +x scripts/create-staging-db.sh
```

- [ ] **Step 2: 语法检查**

Run: `bash -n scripts/create-staging-db.sh`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add scripts/create-staging-db.sh
git commit -m "feat: 新增ZenithJoy staging独立库建库执行脚本"
```

---

### Task 2: 执行建库与切换（生产运维操作）

**Files:**
- 无新文件，执行 Task 1 产出的脚本

- [ ] **Step 1: 记录切换前状态**

Run: `curl -s localhost:5201/health` 和 `plutil -extract EnvironmentVariables.DATABASE_NAME raw ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist`
Expected: health返回200且DATABASE_NAME=zenithjoy_test（切换前基线）

- [ ] **Step 2: 执行脚本**

Run: `bash scripts/create-staging-db.sh`
Expected: 7个Step全部✅，最终输出 `✅ staging已切到独立库 zenithjoy_staging，health check通过`

- [ ] **Step 3: 若失败，人工排查不自动重试**

若Step2非0退出：脚本Step7失败会自动回滚plist，staging应仍在跑（用zenithjoy_test）。检查是哪一步失败，不要自行修复数据，报告失败位置和完整输出。

- [ ] **Step 4: 验证切换后DATABASE_NAME**

Run: `plutil -extract EnvironmentVariables.DATABASE_NAME raw ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist`
Expected: 输出 `zenithjoy_staging`

- [ ] **Step 5: 验证staging真的连的是新库（不是缓存了旧连接）**

Run: `curl -s localhost:5201/health`
Expected: 200且build/config信息正常；再跑一次业务性查询确认（比如staging若有 `/api/health` 之外的DB相关端点，用查库大小或表数量间接验证，若无额外端点则以health通过+DATABASE_NAME plist值为准）

- [ ] **Step 6: Commit（记录执行完成）**

```bash
git add -A
git commit -m "chore: 执行ZenithJoy staging独立库切换" --allow-empty
```

---

## Self-Review 记录

- **Spec coverage**：设计文档3个目标（建独立库/切换/保留旧库）Task1(脚本)+Task2(执行)全覆盖，旧库不删除体现在脚本从不对zenithjoy_test执行任何写操作
- **Placeholder scan**：无TBD，脚本内容完整
- **命名一致性**：`DB_NAME`/`REF_DB`/`PLIST`/`BACKUP_PLIST` 在Task1脚本内自洽，Task2步骤引用同名变量语义一致
- **范围**：单一sprint，无需再拆

---

### Task 3: 3个workflow文件改用可配置的ZJ_STAGING_DB（范围扩大，用户已拍板）

**Files:**
- Modify: `.github/workflows/deploy-us-vps.yml:98`
- Modify: `.github/workflows/promote-prod.yml:91`
- Modify: `.github/workflows/promote-all-prod.yml:153`

- [ ] **Step 1: 三处替换**

在三个文件里，把：
```yaml
          export ZJ_STAGING_DB=zenithjoy_test
```
（`promote-all-prod.yml`是12空格缩进，另两个是10空格缩进，按各文件原缩进不变）改成：
```yaml
          export ZJ_STAGING_DB="${{ vars.ZJ_STAGING_DB || 'zenithjoy_test' }}"
```

- [ ] **Step 2: yaml语法检查**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-us-vps.yml'))" && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/promote-prod.yml'))" && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/promote-all-prod.yml'))"`
Expected: 无输出无报错（三个文件都是合法yaml）

- [ ] **Step 3: 确认没有改到其他行**

Run: `git diff .github/workflows/deploy-us-vps.yml .github/workflows/promote-prod.yml .github/workflows/promote-all-prod.yml`
Expected: 每个文件只有1行改动（`-export ZJ_STAGING_DB=zenithjoy_test` / `+export ZJ_STAGING_DB="${{ vars.ZJ_STAGING_DB || 'zenithjoy_test' }}"`）

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-us-vps.yml .github/workflows/promote-prod.yml .github/workflows/promote-all-prod.yml
git commit -m "feat: ZJ_STAGING_DB改用vars可配置模式(照ZJ_PROD_DB决策0710先例)，默认值不变零风险"
```

---

### Task 4: 合并后翻开关（不在PR里，PR merge后单独执行）

- [ ] **Step 1**: PR merge后执行 `gh variable set ZJ_STAGING_DB --repo perfectuser21/zenithjoy-workspace --body zenithjoy_staging`
- [ ] **Step 2**: 触发一次部署（或等下一次自然部署），确认 `plutil -extract EnvironmentVariables.DATABASE_NAME raw ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist` 变成 `zenithjoy_staging`
- [ ] **Step 3**: `curl -s localhost:5201/health` 200
