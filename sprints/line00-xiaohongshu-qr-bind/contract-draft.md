# Sprint Contract Draft (Round 2)

## Golden Path
[qr_bind/xiaohongshu 触发] → [spawnQrBindOperator 注入 port 19224] → [.cjs 连 Chrome 19224] → [等待 galaxy_creator_session_info cookie 出现] → [登录成功，上传 session]

---

### Step 1: xiaohongshu PLATFORM_SESSION_COOKIES 含正确 cookie 名
**来源**: `[FROM_PRD]` — PRD "Feature 1"：系统能识别 `galaxy_creator_session_info` cookie

**可观测行为**: `qr-bind-operator.ts` xiaohongshu 行不含 `webId`，含 `galaxy_creator_session_info`

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('services/agent/src/handlers/qr-bind-operator.ts','utf8');const l=s.split('\n').find(x=>x.includes('xiaohongshu')&&x.includes('web_session'));if(!l||l.includes('webId')||!l.includes('galaxy_creator_session_info')){console.error('FAIL');process.exit(1)}console.log('OK')"
```
**硬阈值**: exit 0

---

### Step 2: .cjs 同步修复 cookie 名
**来源**: `[FROM_PRD]` — PRD 修改清单第 2 条

**可观测行为**: `qr-bind-operator.cjs` xiaohongshu 行不含 `webId`

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('services/agent/publishers/qr-bind-operator.cjs','utf8');const l=s.split('\n').find(x=>x.includes('xiaohongshu')&&x.includes('web_session'));if(!l||l.includes('webId')||!l.includes('galaxy_creator_session_info')){console.error('FAIL');process.exit(1)}console.log('OK')"
```
**硬阈值**: exit 0

---

### Step 3: spawnQrBindOperator 注入 ZENITHJOY_CHROME_DEBUG_PORT=19224
**来源**: `[FROM_PRD]` — PRD "Feature 2"：spawn 时使用 19224 端口

**可观测行为**: `.ts` 含 `19224` 值 + `ZENITHJOY_CHROME_DEBUG_PORT` env 注入

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('services/agent/src/handlers/qr-bind-operator.ts','utf8');if(!s.includes('19224')||!s.includes('ZENITHJOY_CHROME_DEBUG_PORT')){console.error('FAIL');process.exit(1)}console.log('OK')"
```
**硬阈值**: exit 0

---

### Step 4: 其余平台不受影响（防回归）
**来源**: `[AI_ADDED]` — 防止端口改动波及抖音，GAN Round 1 添加防回归断言

**可观测行为**: 现有 qr-bind-operator 测试全部通过

**验证命令**:
```bash
npx vitest run services/agent/src/handlers/__tests__/qr-bind-operator.test.ts --reporter=verbose 2>&1 | grep -E "✓|✗|Tests"
```
**硬阈值**: 全部现有测试通过

---

### Step 5: 小红书单元测试新增并全绿
**来源**: `[FROM_PRD]` — PRD "Feature 3"：明确断言

**可观测行为**: `tests/ws1/xhs-qr-bind.test.ts` 4 个测试全通过

**验证命令**:
```bash
cd /Users/administrator/perfect21/zenithjoy && npx vitest run sprints/line00-xiaohongshu-qr-bind/tests/ws1/xhs-qr-bind.test.ts --reporter=verbose 2>&1
```
**硬阈值**: exit 0，≥ 3 个 xiaohongshu 测试通过

---

## E2E 验收脚本（local_api）

```bash
#!/bin/bash
set -e
REPO=/Users/administrator/perfect21/zenithjoy
cd "$REPO"

echo "=== Step 1: .ts cookie 名 ==="
node -e "const s=require('fs').readFileSync('services/agent/src/handlers/qr-bind-operator.ts','utf8');const l=s.split('\n').find(x=>x.includes('xiaohongshu')&&x.includes('web_session'));if(!l||l.includes('webId')||!l.includes('galaxy_creator_session_info')){console.error('FAIL');process.exit(1)}console.log('OK')"

echo "=== Step 2: .cjs cookie 名 ==="
node -e "const s=require('fs').readFileSync('services/agent/publishers/qr-bind-operator.cjs','utf8');const l=s.split('\n').find(x=>x.includes('xiaohongshu')&&x.includes('web_session'));if(!l||l.includes('webId')||!l.includes('galaxy_creator_session_info')){console.error('FAIL');process.exit(1)}console.log('OK')"

echo "=== Step 3: CDP port 注入 ==="
node -e "const s=require('fs').readFileSync('services/agent/src/handlers/qr-bind-operator.ts','utf8');if(!s.includes('19224')||!s.includes('ZENITHJOY_CHROME_DEBUG_PORT')){console.error('FAIL');process.exit(1)}console.log('OK')"

echo "=== Step 4: 全量单元测试 ==="
npx vitest run \
  services/agent/src/handlers/__tests__/qr-bind-operator.test.ts \
  sprints/line00-xiaohongshu-qr-bind/tests/ws1/xhs-qr-bind.test.ts \
  --reporter=verbose 2>&1

echo "✅ Golden Path 验证通过"
```

---

## Risks

- **Risk 1**: `PLATFORM_CDP_PORTS` 键名拼写错误（如 `xiaohongshu` typo）→ spawn 回退默认 19222 端口，连到抖音 Chrome，登录检测必然 5min 超时后才失败
  - **Mitigation**: Step 3 BEHAVIOR 验证命令精确匹配字符串 `19224`；vitest `[RED]` 测试以字面量 `19224` 断言，键名 typo 必触发测试失败

- **Risk 2**: xian-pc 若存有历史 xiaohongshu session 文件（只含 `web_session`，不含 `galaxy_creator_session_info`），修复上线后巡检首次会判 expired，触发一次重绑告警
  - **Mitigation**: 此为一次性影响，运营员按提示重新扫码即可；已在 PRD "不在范围内" 注明旧 session 清理不是本次 Sprint 范围
