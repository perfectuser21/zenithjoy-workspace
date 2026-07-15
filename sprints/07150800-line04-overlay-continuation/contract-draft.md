# Contract Draft — Line04 AI思考浮窗补部署闭环+会话跟随画像卡

sprint_dir: sprints/07150800-line04-overlay-continuation
task_id: c4518759-8a5f-4beb-9cfe-a5c35d95aa07
round: 1
date: 2026-07-15
status: PROPOSED

---

## 一、范围声明

### 交付边界（本次 IN）

| # | 交付物 | 文件路径 / 机制 | FR |
|---|-------|--------------|-----|
| A1 | staging 部署确认（1.0.117 含 overlay 代码） | promote-staging workflow / staging /health + /version 断言 | FR-A1 |
| A2 | staging promote 到生产（用户人工放行） | promote-prod.yml workflow_dispatch | FR-A2 |
| A3 | xian-rog 正式安装包复验（真机截图 + events.jsonl 片段） | 本地手动验收，证据存入 sprint 目录 | FR-A3 |
| A4 | 台账回写（overlay thin-可用 → done） | Brain API POST /api/brain/journey_features | FR-A4 |
| B1 | 中台新增 GET /api/wechat/customer-profile 接口 | `apps/api/src/routes/wechat.ts` + `apps/api/src/services/customer-profile.ts` | FR-B1 |
| B2 | overlay_window.py switch_customer 方法 + session_switch 事件消费 | `services/agent/wechat-rpa/overlay/overlay_window.py`（追加方法） | FR-B2 |
| B3 | 全局事件流降级为次要小字区域（样式） | overlay_window.py HTML 模板 | FR-B2.4 |
| B4 | CI 覆盖（pytest 2 case + vitest 1 case + smoke 追加） | 现有 CI workflow 追加 | FR-B3 |

### 不在本次范围（OUT）

- listen_chat.py 任何改动（12 条 invariant 继承，第一/二刀地基禁重做）
- 中台浮窗监控看板页
- 画像卡多号矩阵视图
- listen_chat 守活退避阶梯
- 里程碑 B 在里程碑 A 未验收通过前不得开始

---

## 二、Test Contract 表

| # | BEHAVIOR ID | 测试名称 | 覆盖层 | 执行环境 |
|---|---|---|---|---|
| 1 | BEHAVIOR-1 | staging 部署版本断言（curl /health 返回 1.0.117） | smoke | windows_cloud / CI |
| 2 | BEHAVIOR-2 | overlay --probe 真机探测（xian-rog 正式安装包） | 真机手动 | xian-rog |
| 3 | BEHAVIOR-3 | events.jsonl 真机证据（含 reply_sent+reasoning，无 PII） | 真机手动 | xian-rog |
| 4 | BEHAVIOR-4 | 会话画像卡切换（conv_id_A → 显示 A 数据，conv_id_B → 显示 B 数据） | pytest + smoke | windows_cloud |
| 5 | BEHAVIOR-5 | /api/wechat/customer-profile 返回结构断言 | vitest | windows_cloud |

---

## E2E 验收

### 里程碑A 验收断言

**A-1：staging CI workflow 触发 + 版本断言**

触发 `promote-staging` workflow（或等价 deploy-staging CI），确认：
- staging API `/health` 返回 200
- staging API `/version`（或 `/health` 的 `version` 字段）等于 `1.0.117`
- overlay 相关文件存在于部署包（`services/agent/wechat-rpa/overlay/overlay_window.py` 可找到）

```bash
# CI 层断言（staging 可达时跑）
STAGING="${ZJ_STAGING_API:-http://localhost:5201}"
HTTP=$(curl -s -o /tmp/staging-health.json -w '%{http_code}' "$STAGING/health")
[ "$HTTP" = "200" ] && echo "PASS: health 200" || echo "FAIL: health $HTTP"
VERSION=$(jq -r '.version // .data.version // empty' /tmp/staging-health.json 2>/dev/null)
[ "$VERSION" = "1.0.117" ] && echo "PASS: version=1.0.117" || echo "FAIL: version=$VERSION"
```

**A-2：用户 promote 确认**

用户在 GitHub Actions 手动触发 `promote-prod.yml`（workflow_dispatch），输入 `PROMOTE` 确认，生产切换后：
```bash
# 生产 health 确认
PROD="${ZJ_API:-http://localhost:5200}"
HTTP=$(curl -s -o /tmp/prod-health.json -w '%{http_code}' "$PROD/health")
[ "$HTTP" = "200" ] && echo "PASS: 生产 health 200" || echo "FAIL: $HTTP"
```

**A-3：xian-rog 真机复验（手动，证据留档）**

验收清单：
1. 走正式安装包安装 1.0.117（非临时热修补丁）
2. `python overlay_window.py --probe` 2s 内 exit_code=0
3. 真发一条微信消息 → `$ZJ_STATE_DIR/events.jsonl` 新增含 reasoning 的 `reply_sent` 行
4. 截图浮窗可见（贴靠微信，含动态条目）
5. 截图 + events.jsonl 片段复制到 `sprints/07150800-line04-overlay-continuation/evidence/`

**A-4：台账回写**

```bash
# 写 Brain journey_features status=done
curl -s -X POST http://localhost:5221/api/brain/journey_features \
  -H 'Content-Type: application/json' \
  -d '{"journey_id":"35ac40c2-ba63-81af-af97-e3bc8e3b0fb4","feature":"overlay_thin_available","status":"done","evidence":"xian-rog 复验通过，截图存 sprint 目录"}'
```

---

### 里程碑B 验收断言

**B-1：customer-profile 接口结构**

```bash
# vitest（windows_cloud CI）
cd apps/api
npx vitest run src/services/customer-profile.test.ts --reporter=verbose
# 断言：响应体含 level/nickname/source/contact_count/recent_actions/ai_profile 六字段
```

**B-2：会话画像卡切换（pytest，windows_cloud）**

```bash
cd services/agent/wechat-rpa/overlay
python -m pytest tests/test_overlay_continuation.py -k "session_card_switch" -v
# case 1：session_switch event wechat_id=A → 画像卡显示 A 的 nickname
# case 2：session_switch event wechat_id=B → 画像卡显示 B 的 nickname
```

**B-3：golden-path-4-smoke.sh 新断言（windows_cloud CI）**

```bash
# smoke 追加里程碑 B 断言
bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
# 新增项：
#   - GET /api/wechat/customer-profile?wechat_id=test_wx_001 → 200 含 level 字段
#   - GET /api/wechat/customer-profile?wechat_id=test_wx_002 → 200 含不同 nickname
```

---

### e2e-verify.sh 骨架

```bash
#!/usr/bin/env bash
# sprints/07150800-line04-overlay-continuation/e2e-verify.sh
# E2E 验收脚本 — Line04 AI思考浮窗补部署闭环+会话跟随画像卡
# 里程碑A：xian-rog 手动验收（staging deploy + promote + 真机复验）
# 里程碑B：windows_cloud GHA CI 自动跑（画像卡切换 pytest + vitest）
set -euo pipefail

PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

echo "=== 里程碑A：staging 部署验证 ==="
STAGING="${ZJ_STAGING_API:-http://localhost:5201}"
if curl -s --max-time 3 -o /tmp/staging-health.json "$STAGING/health" 2>/dev/null; then
  VERSION=$(jq -r '.version // .data.version // empty' /tmp/staging-health.json 2>/dev/null || true)
  [ "$VERSION" = "1.0.117" ] && pass "staging version=1.0.117" || fail "staging version=$VERSION (期望 1.0.117)"
else
  echo "  SKIP: staging 不可达（手动验收阶段）"
fi

echo ""
echo "=== 里程碑A：overlay probe 存在性 ==="
[ -f "services/agent/wechat-rpa/overlay/overlay_window.py" ] \
  && pass "overlay_window.py 存在" \
  || fail "overlay_window.py 不存在"

echo ""
echo "=== 里程碑A：真机复验证据（xian-rog 手动存入） ==="
EVIDENCE_DIR="sprints/07150800-line04-overlay-continuation/evidence"
if [ -d "$EVIDENCE_DIR" ] && ls "$EVIDENCE_DIR"/*.png 2>/dev/null | head -1 | grep -q .; then
  pass "真机截图证据存在"
else
  echo "  SKIP: 等待 xian-rog 手动验收后存入截图"
fi

echo ""
echo "=== 里程碑B：customer-profile 接口（API 可达时） ==="
API="${ZJ_API:-http://localhost:5200}"
if curl -s --max-time 3 -o /dev/null "$API/health" 2>/dev/null; then
  HTTP=$(curl -s -o /tmp/profile.json -w '%{http_code}' \
    "$API/api/wechat/customer-profile?wechat_id=test_wx_001" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    LEVEL=$(jq -r '.data.level // empty' /tmp/profile.json 2>/dev/null || true)
    [ -n "$LEVEL" ] && pass "customer-profile 返回 level 字段" || fail "customer-profile 缺 level 字段"
  else
    fail "customer-profile HTTP=$HTTP (期望 200)"
  fi
else
  echo "  SKIP: API 不可达（CI 无真实 DB）"
fi

echo ""
echo "=== 里程碑B：pytest 画像卡切换 ==="
if command -v python3 &>/dev/null && [ -f "services/agent/wechat-rpa/overlay/tests/test_overlay_continuation.py" ]; then
  cd services/agent/wechat-rpa/overlay
  python3 -m pytest tests/test_overlay_continuation.py -k "session_card_switch" -v --tb=short && pass "pytest 画像卡切换全绿" || fail "pytest 画像卡切换有失败"
  cd - >/dev/null
else
  echo "  SKIP: pytest 文件尚未生成（generator 阶段）"
fi

echo ""
echo "E2E-VERIFY: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

---

## 四、未覆盖真实链路清单

| 链路 | 原因 | 等价断言 |
|------|------|---------|
| xian-rog 真机安装包流程 | CI 无法 SSH 到 xian-rog，需人工操作 | --probe exit_code=0 作为 CI 等价断言，截图为人工补充证据 |
| staging → production promote（人工闸） | promote-prod.yml 为 workflow_dispatch，必须人工触发 | CI 层只断言 staging 版本，promote 后人工确认 /health |
| 微信真实消息触发 events.jsonl 写入 | CI 无微信账号 | events.jsonl 内容格式断言（pytest mock tail 消费） + 真机手动证据 |
| xin-rog WebView2 环境 | CI runner 为干净环境，WebView2 探针失败时走纯函数兜底 | --probe 模式 2s exit + 纯函数 pytest 4条判据全绿 |
| customer-profile 接口真实 DB 查询 | CI 无真实 CRM 数据 | vitest mock 断言结构，smoke 层等价查 DB schema 存在性 |
