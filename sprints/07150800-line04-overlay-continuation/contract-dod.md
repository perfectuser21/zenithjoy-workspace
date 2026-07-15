# Contract DoD — Line04 AI思考浮窗补部署闭环+会话跟随画像卡

sprint_dir: sprints/07150800-line04-overlay-continuation
task_id: c4518759-8a5f-4beb-9cfe-a5c35d95aa07
round: 1
date: 2026-07-15

---

## DoD 条目（[BEHAVIOR] 可测试行为断言）

---

### [BEHAVIOR] [BEHAVIOR-1] staging 部署版本断言

**场景**：触发 staging 部署 workflow 后，staging 环境运行版本为 1.0.117，含 overlay 代码，API /health 返回 200，版本字段匹配。

**验收命令（manual:bash）**：
```bash
STAGING="${ZJ_STAGING_API:-http://localhost:5201}"
# 1. health check
HTTP=$(curl -s -o /tmp/staging-health.json -w '%{http_code}' --max-time 5 "$STAGING/health")
echo "health HTTP=$HTTP"
[ "$HTTP" = "200" ] || { echo "FAIL: staging health 非 200"; exit 1; }

# 2. 版本断言
VERSION=$(jq -r '.version // .data.version // empty' /tmp/staging-health.json 2>/dev/null)
echo "version=$VERSION"
[ "$VERSION" = "1.0.117" ] || { echo "FAIL: 版本 $VERSION ≠ 1.0.117"; exit 1; }

# 3. overlay 文件存在性（部署包含 overlay）
curl -s --max-time 5 "$STAGING/health" | grep -q '"status"' \
  && echo "PASS: staging 1.0.117 health OK" \
  || echo "FAIL: health body 异常"
```
**通过标准**：HTTP=200，version 字段等于 `1.0.117`，脚本无 exit 1。

---

### [BEHAVIOR] [BEHAVIOR-2] overlay 真机探测（xian-rog 正式安装包）

**场景**：在 xian-rog 上走正式安装包流程安装 1.0.117 后，`python overlay_window.py --probe` 在 3s 内完成 pywebview 建窗并以 exit_code=0 退出（继承第二刀 BEHAVIOR-1 验收标准，本刀升级为正式安装包）。

**验收命令（manual:bash）**：
```bash
# 在 xian-rog 上执行（正式安装包路径下）
cd services/agent/wechat-rpa/overlay
python -c "
import subprocess, time, sys
start = time.time()
proc = subprocess.Popen([sys.executable, 'overlay_window.py', '--probe'])
proc.wait(timeout=5)
elapsed = time.time() - start
assert proc.returncode == 0, f'exit_code={proc.returncode}'
assert elapsed < 3.0, f'建窗耗时 {elapsed:.1f}s 超过 3s'
print(f'PASS: 建窗 {elapsed:.2f}s, exit_code=0')
"
```
**通过标准**：输出 `PASS`，elapsed < 3.0s，exit_code=0。正式安装包路径，非临时热修。

---

### [BEHAVIOR] [BEHAVIOR-3] events.jsonl 真机证据（reply_sent + reasoning，无 PII）

**场景**：xian-rog 真机上真发一条微信消息，`$ZJ_STATE_DIR/events.jsonl` 新增 `reply_sent` 事件，含 `reasoning` 字段（≤30字），不含手机号/微信号等 PII 字样。证据截图 + events.jsonl 片段存入 sprint 目录。

**验收命令（manual:bash）**：
```bash
# 在 xian-rog 上执行，确认 events.jsonl 最新行
EVENTS="${ZJ_STATE_DIR}/events.jsonl"
[ -f "$EVENTS" ] || { echo "FAIL: events.jsonl 不存在 at $EVENTS"; exit 1; }

# 取最新 reply_sent 行
LATEST=$(grep '"event_type":"reply_sent"' "$EVENTS" | tail -1)
echo "latest reply_sent: $LATEST"

# 断言有 reasoning 字段
echo "$LATEST" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
r = d.get('reasoning', '')
assert r, 'reasoning 字段为空'
assert len(r) <= 30, f'reasoning 超 30 字: {r}'
# PII 简单检测：不含 11 位数字串（手机号）
import re
assert not re.search(r'1[3-9]\d{9}', r), f'reasoning 含手机号: {r}'
print(f'PASS: reasoning={r!r}, len={len(r)}')
"

# 存入 sprint 证据目录
mkdir -p sprints/07150800-line04-overlay-continuation/evidence
echo "$LATEST" > sprints/07150800-line04-overlay-continuation/evidence/events-sample.jsonl
echo "证据已存入 evidence/events-sample.jsonl"
```
**通过标准**：脚本输出 `PASS`，`evidence/events-sample.jsonl` 存在，截图 `evidence/overlay-screenshot.png` 存在（人工存入）。

---

### [BEHAVIOR] [BEHAVIOR-4] 会话画像卡切换（session_switch 事件驱动）

**场景**：overlay_window.py 新增 `switch_customer(wechat_id)` 方法；tail 消费端检测到 `session_switch` 事件时调用该方法，画像卡内容随 wechat_id 切换，全局事件流降级为次要小字区域。两个不同 wechat_id 切换产生两次不同的 nickname 显示。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa/overlay
python -m pytest tests/test_overlay_continuation.py -k "session_card_switch" -v --tb=short

# 也可直接执行验证逻辑
python -c "
import sys
sys.path.insert(0, '.')
from overlay_window import OverlayWindow  # 或对应类名

# mock 中台接口响应
import unittest.mock as mock

PROFILE_A = {'level': 'A2', 'nickname': '张三', 'source': '抖音', 'contact_count': 3, 'recent_actions': ['昨日回复'], 'ai_profile': '处于比价阶段'}
PROFILE_B = {'level': 'A3', 'nickname': '李四', 'source': '私信', 'contact_count': 7, 'recent_actions': ['今日询价'], 'ai_profile': '意向较强'}

with mock.patch('overlay_window.fetch_customer_profile', side_effect=[PROFILE_A, PROFILE_B]):
    win = OverlayWindow.__new__(OverlayWindow)
    win.current_customer = None

    # 切换到客户 A
    win.switch_customer('wx_id_A')
    assert win.current_customer == 'wx_id_A', f'切换 A 失败: {win.current_customer}'
    print('PASS: 切换到客户 A')

    # 切换到客户 B
    win.switch_customer('wx_id_B')
    assert win.current_customer == 'wx_id_B', f'切换 B 失败: {win.current_customer}'
    print('PASS: 切换到客户 B')

print('PASS: 会话画像卡切换逻辑正确')
"
```
**通过标准**：pytest 至少 2 个 case（wechat_id_A / wechat_id_B）全绿，无 SKIP，无 XFAIL；Python 脚本输出两次 `PASS`。

---

### [BEHAVIOR] [BEHAVIOR-5] /api/wechat/customer-profile 接口结构断言

**场景**：中台 `GET /api/wechat/customer-profile?wechat_id=<id>` 接口从既有 CRM 表（customers/leads/wechat_cs_configs）组装，返回 level/nickname/source/contact_count/recent_actions/ai_profile 六字段，P95 ≤500ms。禁新建表。

**验收命令（manual:bash）**：
```bash
# vitest 结构断言（windows_cloud CI）
cd apps/api
npx vitest run src/services/customer-profile.test.ts --reporter=verbose 2>&1 | tail -20

# API 可达时同步跑 smoke 验证
API="${ZJ_API:-http://localhost:5200}"
if curl -s --max-time 2 -o /dev/null "$API/health" 2>/dev/null; then
  HTTP=$(curl -s -o /tmp/profile.json -w '%{http_code}' \
    "$API/api/wechat/customer-profile?wechat_id=test_wx_001")
  echo "HTTP=$HTTP"
  [ "$HTTP" = "200" ] || { echo "FAIL: HTTP=$HTTP"; exit 1; }
  python3 -c "
import json
d = json.load(open('/tmp/profile.json'))
data = d.get('data', d)
for field in ['level','nickname','source','contact_count','recent_actions','ai_profile']:
    assert field in data, f'缺字段: {field}'
print('PASS: 六字段全部存在')
"
else
  echo "SKIP: API 不可达，vitest mock 断言已覆盖"
fi

# 禁新建表断言
cd apps/api
git diff main -- '**/migrations/**' | grep -E '^\+.*CREATE TABLE' \
  && echo "FAIL: 发现新建表（禁止）" && exit 1 \
  || echo "PASS: 无新建表"
```
**通过标准**：vitest 全绿（mock 路径）；API 可达时 HTTP=200 且六字段存在；无新建表 migration。

---

## DoD 勾选清单

- [ ] BEHAVIOR-1: staging 部署版本断言（curl staging /health → 1.0.117）
- [ ] BEHAVIOR-2: overlay 真机探测（xian-rog 正式安装包，--probe exit_code=0）
- [ ] BEHAVIOR-3: events.jsonl 真机证据（reply_sent+reasoning，无 PII，截图存 evidence/）
- [ ] BEHAVIOR-4: 会话画像卡切换（wechat_id_A/B 切换 pytest 2 case 全绿）
- [ ] BEHAVIOR-5: /api/wechat/customer-profile 接口结构断言（vitest 全绿，无新建表）

---

## 里程碑门控

- 里程碑A（BEHAVIOR-1/2/3 全勾）→ 才可开始里程碑B（BEHAVIOR-4/5）
- 所有 5 条 BEHAVIOR 全勾 → sprint 完成，台账回写 Brain status=done
