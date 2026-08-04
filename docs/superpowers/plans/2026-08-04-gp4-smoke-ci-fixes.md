# gp4 智能客服 smoke CI 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `golden-path-4-smoke`（智能客服 line04 gp4）CI 测试的 5 类结构性可信度缺口：专属 workflow 不起 DB/API 导致关键步骤静默 SKIP 仍报 PASS、Step 17d 引用的 CI job 不存在、Step 9/12 缺少已知事故类型的回归守卫、Smoke Glob Gate 隐式依赖脚本执行顺序、product-map 六条现役 GP 未挂接 smoke_files。

**Architecture:** 只改 CI 配置（`.github/workflows/*.yml`）、测试脚本（`golden-path-4-smoke.sh`）、数据文件（`product-map/product-map.yaml`）三类文件，不碰任何生产运行时代码（`apps/api/src/**`、`services/agent/**` 均只读不改）。每个任务对应审计的一条独立发现，可单独 review、单独验证。

**Tech Stack:** GitHub Actions workflow YAML、bash、Node.js（product-map 生成脚本）。

## Global Constraints

- 不改任何生产运行时代码（`apps/api/src/**`、`services/agent/wechat-rpa/**` 等）——本次修复范围仅限 CI/测试基建。
- `product-map/product-map.yaml` 的 `smoke_files` 字段 schema 要求 `minItems: 1`——不能写空数组，没有对应 smoke 的 GP 必须完全省略该字段（不能写 `smoke_files: []`）。
- 每处修复必须能"故意弄坏后亲眼看它报红一次"（proven-to-fire），验证步骤里必须包含这一步，不能只是"逻辑上应该会检测到"。
- `.github/workflows/golden-path-4-smoke.yml` 最终 job 改动后必须保持能在 CI 里正常跑通全部 17 步（不再出现 SKIP）。
- `product-map/product-map.yaml` 改动后必须本地跑一遍 `npm run product-map:generate && npm run product-map:check` 且 exit 0，并把生成的 `product-map/generated/*` 一并提交（否则 CI 的 `ci-l2-consistency.yml` L2 Consistency Gate 会因 drift 报红）。

---

### Task 1: golden-path-4-smoke.yml 最终 job 补齐 DB/API 基建 + agent-panel 依赖

**Files:**
- Modify: `.github/workflows/golden-path-4-smoke.yml:103-125`（`golden-path-4-smoke` job 全量重写）

**Interfaces:**
- Consumes：无（workflow 层改动，无代码接口）
- Produces：`golden-path-4-smoke` job 现在会真实起 postgres + apps/api，供 Task 2（脚本里的 fail-open 判断）在真实环境下生效；同时给 Task 3（Step 17d）提供已装好的 `apps/agent-panel/node_modules`。

- [ ] **Step 1: 替换 `golden-path-4-smoke` job 定义**

把 `.github/workflows/golden-path-4-smoke.yml` 第 103-125 行（原始内容如下）：

```yaml
  golden-path-4-smoke:
    name: Golden Path 4 — Full 6-step E2E Smoke
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # 合同 r1 #14：ws1..ws5 全绿才跑完整端到端
    needs: [ws1, ws2, ws3, ws4, ws5]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: services/agent/package-lock.json }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      # Step 17（作战窗刀1）需要真跑 services/agent 的 TS 逻辑证明看门狗 proven-to-fire，
      # 不是静态 grep——装依赖才能用 tsx 直接执行。
      - name: Install services/agent deps (for Step 17 panel-event-bus proven-to-fire check)
        run: npm ci --no-audit --no-fund
        working-directory: services/agent
      - name: Run full golden-path-4-smoke (REAL_PUBLISH=0 dryrun)
        env:
          REAL_PUBLISH: '0'
          CI: 'true'
        run: bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```

替换为：

```yaml
  golden-path-4-smoke:
    name: Golden Path 4 — Full 6-step E2E Smoke
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # 合同 r1 #14：ws1..ws5 全绿才跑完整端到端
    needs: [ws1, ws2, ws3, ws4, ws5]
    # 2026-08-04 修复（假绿灯审计）：此前本 job 不起 DB/API，脚本探测到不可达就整段 SKIP
    # 仍报 PASS——Step 1/7/8/9/12/13/14 从未在这条跑道上真跑过。真覆盖只发生在
    # Smoke Glob Gate（ci-smoke-glob-runner.yml）。现补齐同款 DB/API 基建，让这条
    # 专属跑道的名字（"Full ... E2E Smoke"）名副其实。
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: cecelia
          POSTGRES_PASSWORD: cecelia
          POSTGRES_DB: cecelia
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_HOST: localhost
      DATABASE_PORT: 5432
      DATABASE_USER: cecelia
      DATABASE_PASSWORD: cecelia
      DATABASE_NAME: cecelia
      DATABASE_URL: postgres://cecelia:cecelia@localhost:5432/cecelia
      DB_URL: postgres://cecelia:cecelia@localhost:5432/cecelia
      PORT: 5200
      NODE_ENV: test
      API_BASE: http://localhost:5200
      ADMIN_FEISHU_OPENIDS: ou_admin_smoke_999
      BETTER_AUTH_SECRET: ci-only-secret-32-chars-min-not-prod-123
      BETTER_AUTH_URL: http://localhost:5200
      ZENITHJOY_INTERNAL_TOKEN: ci-only-internal-token-abc-not-prod
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: services/agent/package-lock.json }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }

      - name: Install apps/api deps
        run: npm ci --workspace=apps/api

      # Step 17（作战窗刀1）需要真跑 services/agent 的 TS 逻辑证明看门狗 proven-to-fire，
      # 不是静态 grep——装依赖才能用 tsx 直接执行。
      - name: Install services/agent deps (for Step 17 panel-event-bus proven-to-fire check)
        run: npm ci --no-audit --no-fund
        working-directory: services/agent

      # 2026-08-04 修复（Step 17d 假绿）：脚本此前声称"CI 独立 job 已跑"业务语言渲染单测，
      # 实际全仓库无该 job。装了依赖后脚本自带的 `[ -d node_modules ]` 分支会自动真跑 vitest。
      - name: Install apps/agent-panel deps (for Step 17d business-language vitest)
        run: npm ci --no-audit --no-fund
        working-directory: apps/agent-panel

      - name: Create zenithjoy schema + pgcrypto
        env:
          PGPASSWORD: cecelia
        run: |
          psql -h localhost -U cecelia -d cecelia -c "CREATE SCHEMA IF NOT EXISTS zenithjoy;"
          psql -h localhost -U cecelia -d cecelia -c "CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";"

      - name: Run apps/api/db migrations
        env:
          PGPASSWORD: cecelia
        run: |
          for f in apps/api/db/migrations/*.sql; do
            echo "→ $f"
            psql -h localhost -U cecelia -d cecelia -v ON_ERROR_STOP=1 -f "$f"
          done

      - name: Build apps/api
        working-directory: apps/api
        run: npm run build

      - name: Start apps/api
        working-directory: apps/api
        run: |
          node dist/index.js > /tmp/apps-api.log 2>&1 &
          echo $! > /tmp/apps-api.pid
          for i in $(seq 1 40); do
            curl -fs http://localhost:5200/health >/dev/null 2>&1 && { echo "apps/api ready ${i}s"; break; }
            sleep 1
          done
          curl -fs http://localhost:5200/health || (cat /tmp/apps-api.log && exit 1)

      - name: Run full golden-path-4-smoke (REAL_PUBLISH=0 dryrun)
        env:
          REAL_PUBLISH: '0'
          CI: 'true'
        run: bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
```

- [ ] **Step 2: 本地 YAML 语法校验**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/golden-path-4-smoke.yml'))" && echo "YAML OK"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/golden-path-4-smoke.yml
git commit -m "fix(ci): gp4 smoke 专属job补DB/API基建+agent-panel依赖，去掉SKIP假绿跑道"
```

---

### Task 2: golden-path-4-smoke.sh — CI=true 时 DB/API 不可达必须 fail，不许静默 SKIP

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh:63-69`

**Interfaces:**
- Consumes：Task 1 已让 `golden-path-4-smoke` job 真实起了 DB/API（正常路径下 `DB_REACHABLE=1`/`API_REACHABLE=1`，本改动不影响该 job 的绿灯）
- Produces：`CI=true` 环境下，若未来任何原因导致 DB/API 又变得不可达，脚本会立即以非 0 退出，而不是把 Step 1/7/8/9/12/13/14 悄悄 SKIP 掉后仍报 PASS

- [ ] **Step 1: 修改可达性探测块**

把 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` 第 63-69 行（原始内容）：

```bash
psq() { psql "$DB_URL" -Atq -c "$1"; }

DB_REACHABLE=0
if psql "$DB_URL" -c '\q' 2>/dev/null; then DB_REACHABLE=1; fi
API_REACHABLE=0
if curl -s --max-time 2 -o /dev/null "$API_BASE/health" 2>/dev/null; then API_REACHABLE=1; fi
```

替换为：

```bash
psq() { psql "$DB_URL" -Atq -c "$1"; }

DB_REACHABLE=0
if psql "$DB_URL" -c '\q' 2>/dev/null; then DB_REACHABLE=1; fi
API_REACHABLE=0
if curl -s --max-time 2 -o /dev/null "$API_BASE/health" 2>/dev/null; then API_REACHABLE=1; fi

# 2026-08-04 修复（假绿灯审计）：CI 环境下 DB/API 不可达绝不允许静默 SKIP——
# 之前专属 workflow 不起 DB/API，关键步骤(1/7/8/9/12/13/14)整段 SKIP 仍报 PASS。
# 本地手跑（无 CI 标记）仍允许 SKIP 降级，方便开发者没起本地服务时快速跑纯函数段。
if [ "${CI:-}" = "true" ]; then
  [ "$DB_REACHABLE" -eq 1 ] || fail "DB 不可达（CI=true 下不允许静默 SKIP，检查 postgres service / DATABASE_URL 是否已配好）" 1
  [ "$API_REACHABLE" -eq 1 ] || fail "API 不可达（CI=true 下不允许静默 SKIP，检查 apps/api 是否已构建启动 / /health 是否通）" 1
fi
```

- [ ] **Step 2: 验证会真报红（proven-to-fire）**

Run:
```bash
cd /Users/administrator/worktrees/zenithjoy/session-496e716c
CI=true API_BASE=http://localhost:1 DB_URL=postgresql://nouser:nopass@localhost:1/nodb \
  bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh; echo "EXIT=$?"
```
Expected: 输出包含 `❌ Step 1 DB 不可达（CI=true 下不允许静默 SKIP...`，且 `EXIT=1`（非 0）

- [ ] **Step 3: 验证正常可达环境不受影响**

Run（不设 CI 变量，模拟本地开发者手跑，DB/API 本就不可达的降级路径应保留）：
```bash
API_BASE=http://localhost:1 DB_URL=postgresql://nouser:nopass@localhost:1/nodb \
  bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh; echo "EXIT=$?"
```
Expected: 出现 `SKIP: API 不可达...` 字样（非 CI 环境仍允许降级），且脚本继续跑完剩余纯函数段，`EXIT=0`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh
git commit -m "fix(test): golden-path-4-smoke CI=true下DB/API不可达必须fail，禁止静默SKIP"
```

---

### Task 3: golden-path-4-smoke.sh — Step 9 补 §1.9 同型回归守卫（takeover_mode/blacklist）

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh:370-394`（Step 9 段落末尾追加 Step 9c）

**Interfaces:**
- Consumes：Step 9a 已建立的 `$S9_WECHAT`（本步骤复用同一个 wechat_id）；已存在的真实路由 `PUT /api/crm/customers/identity`（`apps/api/src/routes/crm.ts` ~369 行，body: `wechat_id`/`contact`/`identity`）与 `GET /api/wechat/cs/config/:wechatId`
- Produces：无新增下游依赖（本段是脚本末端新增断言）

- [ ] **Step 1: 在 Step 9 末尾（第 391 行 `ok "Step 9 ✅ 白名单/接管模式配置链路通"` 之后、`else` 分支之前）追加 Step 9c**

原始第 373-394 行：

```bash
echo "▶ Step 9: 白名单/接管模式（cs/config upsert + 回读一致）"

if [ "$API_REACHABLE" -eq 1 ]; then
  S9_WECHAT="gp4-smoke-cswx-${RND}"
  S9_TMP=$(mktemp)
  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 \
    -X PUT "$API_BASE/api/wechat/cs/config/$S9_WECHAT" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d '{"persona":{"self_name":"gp4-smoke客服"},"auto_agent_enabled":true,"whitelist":["gp4-smoke-whitelist-name"]}')
  [ "$S9_HTTP" = "200" ] || fail "Step 9a PUT cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  ok "Step 9a ✅ 白名单/接管配置写入成功（whitelist=[gp4-smoke-whitelist-name]）"

  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 "$API_BASE/api/wechat/cs/config/$S9_WECHAT")
  [ "$S9_HTTP" = "200" ] || fail "Step 9b GET cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'gp4-smoke-whitelist-name' in (d.get('whitelist') or [])" "$S9_TMP" 2>/dev/null \
    || fail "Step 9b 回读 whitelist 不一致: $(cat "$S9_TMP")" 9
  rm -f "$S9_TMP"
  ok "Step 9b ✅ 回读一致（whitelist 含 gp4-smoke-whitelist-name）"
  ok "Step 9 ✅ 白名单/接管模式配置链路通"
else
  echo "  SKIP: API 不可达"
fi
```

替换为（在 `ok "Step 9 ✅ ..."` 之后、`else` 之前插入 Step 9c 块）：

```bash
echo "▶ Step 9: 白名单/接管模式（cs/config upsert + 回读一致）"

if [ "$API_REACHABLE" -eq 1 ]; then
  S9_WECHAT="gp4-smoke-cswx-${RND}"
  S9_TMP=$(mktemp)
  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 \
    -X PUT "$API_BASE/api/wechat/cs/config/$S9_WECHAT" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d '{"persona":{"self_name":"gp4-smoke客服"},"auto_agent_enabled":true,"whitelist":["gp4-smoke-whitelist-name"]}')
  [ "$S9_HTTP" = "200" ] || fail "Step 9a PUT cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  ok "Step 9a ✅ 白名单/接管配置写入成功（whitelist=[gp4-smoke-whitelist-name]）"

  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 "$API_BASE/api/wechat/cs/config/$S9_WECHAT")
  [ "$S9_HTTP" = "200" ] || fail "Step 9b GET cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'gp4-smoke-whitelist-name' in (d.get('whitelist') or [])" "$S9_TMP" 2>/dev/null \
    || fail "Step 9b 回读 whitelist 不一致: $(cat "$S9_TMP")" 9
  rm -f "$S9_TMP"
  ok "Step 9b ✅ 回读一致（whitelist 含 gp4-smoke-whitelist-name）"

  # Step 9c（2026-08-04，§1.9 同型回归守卫，issue PR#1146）：§1.9 事故根因是 getCSConfig
  # 的 SELECT 曾漏掉 takeover_mode/blacklist 两列，导致"全接管"前台看着配了、agent 端
  # 却读不到、形同虚设。真实黑名单写入走的是 PUT /api/crm/customers/identity（非本
  # cs/config 路由——该路由职责是 persona/whitelist/hours，blacklist 归 CRM 管），
  # 这里调用真实路由写入再回读 cs/config，精确重演该事故的失败模式（SELECT 漏列
  # → 字段从响应消失）。
  S9C_CONTACT="gp4-smoke-blacklist-${RND//-/}"
  S9C_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 \
    -X PUT "$API_BASE/api/crm/customers/identity" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d "{\"wechat_id\":\"$S9_WECHAT\",\"contact\":\"$S9C_CONTACT\",\"identity\":\"blacklist\"}")
  [ "$S9C_HTTP" = "200" ] || fail "Step 9c PUT crm/customers/identity expected 200, got $S9C_HTTP: $(cat "$S9_TMP")" 9

  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 "$API_BASE/api/wechat/cs/config/$S9_WECHAT")
  [ "$S9_HTTP" = "200" ] || fail "Step 9c GET cs/config(回读blacklist) expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert '$S9C_CONTACT' in (d.get('blacklist') or [])" "$S9_TMP" 2>/dev/null \
    || fail "Step 9c blacklist 回读不含刚拉黑的联系人（§1.9 SELECT 漏列同型回归）: $(cat "$S9_TMP")" 9
  rm -f "$S9_TMP"
  ok "Step 9c ✅ blacklist 回读含刚拉黑的联系人（§1.9 SELECT 漏列同型回归守卫）"
  ok "Step 9 ✅ 白名单/接管模式配置链路通"
else
  echo "  SKIP: API 不可达"
fi
```

- [ ] **Step 2: 本地起 API+DB 验证新增断言通过**

（需本地已有 apps/api 可跑的 postgres + `zenithjoy` schema + 已启动的 apps/api，若本地无此环境则跳过此步，交由 CI 验证）

Run: `API_BASE=http://localhost:5200 CI=true bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | grep "Step 9"`
Expected: 输出含 `Step 9c ✅ blacklist 回读含刚拉黑的联系人`

- [ ] **Step 3: proven-to-fire——故意验证断言会真的抓到回归**

Run（临时验证：把 `getCSConfig` 的 SELECT 语句改成不含 `blacklist` 列，重跑上面命令，确认 Step 9c 报红，然后 `git checkout -- apps/api/src/services/wechat/cs-account-config-store.ts` 撤销这个临时改动）：
```bash
sed -i.bak "s/key_contact_wechat, whitelist, takeover_mode, blacklist, daily_limit, updated_at/key_contact_wechat, whitelist, takeover_mode, daily_limit, updated_at/" apps/api/src/services/wechat/cs-account-config-store.ts
# 重新 build + 重启 apps/api 后重跑脚本，确认 Step 9c 报红
# 验证完毕后必须撤销：
git checkout -- apps/api/src/services/wechat/cs-account-config-store.ts
rm -f apps/api/src/services/wechat/cs-account-config-store.ts.bak
```
Expected: 临时改坏后重跑脚本，Step 9c 输出 `❌ Step 9c blacklist 回读不含刚拉黑的联系人（§1.9 SELECT 漏列同型回归）`；撤销后恢复原状

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh
git commit -m "test(gp4): Step9补§1.9同型回归守卫——blacklist经CRM路由写入后cs/config必须回读到"
```

---

### Task 4: golden-path-4-smoke.sh — Step 12 补阳性对照

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh:430-457`

**Interfaces:**
- Consumes：Step 12a 已写入的 `$S12_TENANT_A`/`$S12_CONTACT`/`"租户A的悄悄话"`（本步骤复用同一批变量）；已存在路由 `GET /api/wechat/memory/context`
- Produces：无新增下游依赖

- [ ] **Step 1: 在 Step 12a 之后、Step 12b 之前插入阳性对照**

原始第 430-446 行：

```bash
if [ "$API_REACHABLE" -eq 1 ] && [ "$DB_REACHABLE" -eq 1 ]; then
  S12_TENANT_A=$(psq "SELECT gen_random_uuid()::text")
  S12_TENANT_B=$(psq "SELECT gen_random_uuid()::text")
  S12_CONTACT="gp4smokemem${RND//-/}"
  S12_TMP=$(mktemp)

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/wechat/memory/message" \
    -H "Content-Type: application/json" -H "X-Tenant-Id: $S12_TENANT_A" \
    -d "{\"contact\":\"$S12_CONTACT\",\"role\":\"in\",\"text\":\"租户A的悄悄话\"}")
  [ "$S12_HTTP" = "200" ] || fail "Step 12a memory/message(租户A) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    "$API_BASE/api/wechat/memory/context?contact=$S12_CONTACT" -H "X-Tenant-Id: $S12_TENANT_B")
  [ "$S12_HTTP" = "200" ] || fail "Step 12b memory/context(租户B) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12
  grep -q "租户A的悄悄话" "$S12_TMP" && fail "Step 12b 租户隔离违规：租户B读到了租户A的对话内容" 12
  ok "Step 12b ✅ 租户隔离验证：B 读不到 A 的记忆"
```

替换为（在 Step 12a 校验之后插入阳性对照，再进入原 Step 12b）：

```bash
if [ "$API_REACHABLE" -eq 1 ] && [ "$DB_REACHABLE" -eq 1 ]; then
  S12_TENANT_A=$(psq "SELECT gen_random_uuid()::text")
  S12_TENANT_B=$(psq "SELECT gen_random_uuid()::text")
  S12_CONTACT="gp4smokemem${RND//-/}"
  S12_TMP=$(mktemp)

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/wechat/memory/message" \
    -H "Content-Type: application/json" -H "X-Tenant-Id: $S12_TENANT_A" \
    -d "{\"contact\":\"$S12_CONTACT\",\"role\":\"in\",\"text\":\"租户A的悄悄话\"}")
  [ "$S12_HTTP" = "200" ] || fail "Step 12a memory/message(租户A) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12

  # Step 12a2（2026-08-04，阳性对照）：原测试只验"B 读不到 A"，缺"A 能读到自己写的"——
  # 若 memory/context 整体坏死（对谁都返回空），隔离测试会因为"系统根本没工作"而误判通过。
  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    "$API_BASE/api/wechat/memory/context?contact=$S12_CONTACT" -H "X-Tenant-Id: $S12_TENANT_A")
  [ "$S12_HTTP" = "200" ] || fail "Step 12a2 memory/context(租户A自读) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12
  grep -q "租户A的悄悄话" "$S12_TMP" || fail "Step 12a2 阳性对照失败：租户A读不到自己刚写的记忆（memory/context 可能整体坏死）" 12
  ok "Step 12a2 ✅ 阳性对照：租户A能读到自己写的记忆"

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    "$API_BASE/api/wechat/memory/context?contact=$S12_CONTACT" -H "X-Tenant-Id: $S12_TENANT_B")
  [ "$S12_HTTP" = "200" ] || fail "Step 12b memory/context(租户B) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12
  grep -q "租户A的悄悄话" "$S12_TMP" && fail "Step 12b 租户隔离违规：租户B读到了租户A的对话内容" 12
  ok "Step 12b ✅ 租户隔离验证：B 读不到 A 的记忆"
```

- [ ] **Step 2: 验证（有本地 API+DB 环境时）**

Run: `API_BASE=http://localhost:5200 CI=true bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1 | grep "Step 12"`
Expected: 输出含 `Step 12a2 ✅ 阳性对照：租户A能读到自己写的记忆`，且 Step 12b 依旧通过

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scripts/smoke/golden-path-4-smoke.sh
git commit -m "test(gp4): Step12补阳性对照——租户A须读到自己写的记忆，防隔离测试靠系统整体坏死侥幸通过"
```

---

### Task 5: ci-smoke-glob-runner.yml — 显式安装 services/agent 依赖，去掉隐式耦合

**Files:**
- Modify: `.github/workflows/ci-smoke-glob-runner.yml:91-94`

**Interfaces:**
- Consumes：无
- Produces：`services/agent/node_modules` 在 Smoke Glob Runner job 里稳定存在，`golden-path-4-smoke.sh` 的 Step 17c/17e（`npx tsx` 真跑 panel-event-bus proven-to-fire）不再依赖字母序排在前面的兄弟脚本顺手装依赖

- [ ] **Step 1: 在 "Install apps/api deps" 步骤后插入显式安装步骤**

把 `.github/workflows/ci-smoke-glob-runner.yml` 第 91-94 行（原始内容）：

```yaml
      - name: Install apps/api deps
        run: npm ci --workspace=apps/api

      - name: Create zenithjoy schema + pgcrypto
```

替换为：

```yaml
      - name: Install apps/api deps
        run: npm ci --workspace=apps/api

      # 2026-08-04 修复（假绿灯审计）：golden-path-4-smoke.sh 的 Step 17c/17e 需要
      # services/agent/node_modules 存在才能用 npx tsx 真跑 panel-event-bus proven-to-fire。
      # 此前这条 workflow 从不显式装它，全靠字母序排在前面的兄弟脚本（如
      # agent-core-self-upgrade-smoke.sh）顺手装上——那些脚本一改名/一挪走/一改安装逻辑，
      # gp4 的 Step 17c/17e 就会红。显式装，去掉这层隐式耦合。
      - name: Install services/agent deps (golden-path-4-smoke Step 17 depends on this)
        run: npm ci --no-audit --no-fund
        working-directory: services/agent

      - name: Create zenithjoy schema + pgcrypto
```

- [ ] **Step 2: 本地 YAML 语法校验**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-smoke-glob-runner.yml'))" && echo "YAML OK"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci-smoke-glob-runner.yml
git commit -m "fix(ci): Smoke Glob Runner显式装services/agent依赖，去掉对兄弟脚本执行顺序的隐式耦合"
```

---

### Task 6: product-map.yaml — 六条现役智能客服 GP 补 smoke_files

**Files:**
- Modify: `product-map/product-map.yaml:187-272`（六条 GP 定义各自追加 `smoke_files` 字段）
- Modify（自动生成，不手写）: `product-map/generated/product-map.json`、`product-map/generated/product-map.md`

**Interfaces:**
- Consumes：`.github/workflows/scripts/smoke/golden-path-4-smoke.sh`、`gpa-voice-outreach-smoke.sh`、`gpa-voice-rtc-smoke.sh`、`line04-wxid-whitelist-smoke.sh`、`line04-cs-memory-smoke.sh`、`line04-cs-tenant-isolation-smoke.sh`、`path4-sprint-1-ws4-smoke.sh`、`cs-daily-report-smoke.sh`（全部已存在，本任务不新建任何脚本）
- Produces：`npm run product-map:check` 校验通过；`ci-l2-consistency.yml` 的 `product-map-drift` job 保持绿

- [ ] **Step 1: 编辑 `cs_shared_binding`（第 187-199 行）**

原始：

```yaml
  - id: cs_shared_binding
    line_id: line04
    name: 智能客服·绑定/安装（共享前置）
    status: active
    steps:
      - id: step1
        name: 注册自动登录
      - id: step2
        name: 装客户端 + Agent 连中台
      - id: step3
        name: 扫码绑定微信号
```

替换为（在 `status: active` 后插入 `smoke_files`）：

```yaml
  - id: cs_shared_binding
    line_id: line04
    name: 智能客服·绑定/安装（共享前置）
    status: active
    smoke_files:
      - .github/workflows/scripts/smoke/golden-path-4-smoke.sh
    steps:
      - id: step1
        name: 注册自动登录
      - id: step2
        name: 装客户端 + Agent 连中台
      - id: step3
        name: 扫码绑定微信号
```

- [ ] **Step 2: 编辑 `active_voice_outreach`（第 201-214 行左右）**

在其 `status: active` 后插入：

```yaml
    smoke_files:
      - .github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh
      - .github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh
```

- [ ] **Step 3: 编辑 `passive_reception`（第 216-229 行左右）**

在其 `status: active` 后插入：

```yaml
    smoke_files:
      - .github/workflows/scripts/smoke/golden-path-4-smoke.sh
      - .github/workflows/scripts/smoke/line04-wxid-whitelist-smoke.sh
      - .github/workflows/scripts/smoke/line04-cs-memory-smoke.sh
      - .github/workflows/scripts/smoke/line04-cs-tenant-isolation-smoke.sh
```

- [ ] **Step 4: 编辑 `moments_publish`（第 231-242 行左右）**

在其 `status: active` 后插入（仅覆盖"内容成稿"一步，如实注明缺口）：

```yaml
    # 仅覆盖 step1（内容成稿）；发布上圈(step2)/发布确认与留痕(step3) 目前无对应 smoke，
    # 真实覆盖缺口——2026-08-04 审计发现，待后续 sprint 补齐。
    smoke_files:
      - .github/workflows/scripts/smoke/path4-sprint-1-ws4-smoke.sh
```

- [ ] **Step 5: 编辑 `business_report`（第 244-255 行左右）**

在其 `status: active` 后插入：

```yaml
    # cs-daily-report-smoke.sh 目前是存量债（Smoke Glob Gate 非阻断），非必绿基线。
    smoke_files:
      - .github/workflows/scripts/smoke/cs-daily-report-smoke.sh
```

- [ ] **Step 6: 编辑 `moments_interaction` 与 `group_operation`（第 257-272 行左右）**

不添加 `smoke_files` 字段（schema `minItems: 1` 不允许空数组），只在 `status: active` 后加一行纯注释，如实标注缺口：

```yaml
    # 2026-08-04 审计：暂无对应 smoke 脚本，真实覆盖缺口，待后续 sprint 补齐。
```

（`moments_interaction`、`group_operation` 各自加一行同款注释，不加 `smoke_files` 字段）

- [ ] **Step 7: 生成投影 + 校验漂移**

Run:
```bash
npm run product-map:generate
npm run product-map:check
```
Expected: 两条命令都 exit 0；`product-map:check` 输出不含 `GP-SMOKE-MISSING` / `GP-SMOKE-EMPTY` 错误

- [ ] **Step 8: 跑 product-map 自带单测**

Run: `npm run test:product-map`
Expected: 全部通过

- [ ] **Step 9: Commit（含生成文件）**

```bash
git add product-map/product-map.yaml product-map/generated/product-map.json product-map/generated/product-map.md
git commit -m "docs(product-map): 智能客服六条现役GP补smoke_files，如实标注朋友圈互动/社群运营覆盖缺口"
```

---

## Self-Review 记录

- **Spec coverage**：五个审计发现分别对应 Task 1+2（发现1）、Task 1（发现2）、Task 3（发现3）、Task 4（发现4）、Task 5+6（发现5）——全部覆盖，无遗漏。
- **Placeholder scan**：无 TBD/TODO；`moments_interaction`/`group_operation` 的"留空"是设计决策（schema 约束 + 如实标注缺口），不是占位符。
- **Type/接口一致性**：各任务修改的是不同文件的独立片段，无跨任务函数签名依赖；Task 3/4 复用 Task 无关的、脚本内已有的变量名（`$S9_WECHAT`/`$S12_TENANT_A`/`$S12_CONTACT`），均已在对应 Step 核对过原脚本确实存在这些变量。
- **Scope check**：全部改动集中在 3 类文件（workflow yml / smoke sh / product-map yaml），无需再拆分子项目。
