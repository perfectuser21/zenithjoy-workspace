# Contract Draft — Line04 半死区修复：窗口形态不变量 + 梯度自愈 + skip reason 细分

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| sprint_dir | sprints/07201740-half-deadzone-window-invariant |
| journey | Path 4 客户私域 AI 接管 |
| target_environment | windows_cloud |
| module_version_bump | 1.0.149 → 1.0.150 |
| contract_version | v1（首轮，无 reviewer feedback） |

---

## 合同范围

本合同覆盖以下三层修复 + 一项顺手加固：

- **L1** `判群前窗口形态不变量`：reply_in_chat 读标题前先断言窗口非 iconic 且已最大化，违反 → SW_MAXIMIZE 修形 → 重读；
- **L2** `半死区梯度自愈`：跨 ≥2 sender 连续 title_unreadable 计数达阈值 → dump 诊断 → 修形复测 → 升级重启；
- **L3** `skip reason 细分`：_header_confirms_not_group 拆分返回 title_unreadable / is_group，进 _SkipCounter 和 build_diag；
- **L4** `待发队列过期上限`：record_reply_failure 追加 enqueued_at，select_due_retries 支持 max_age_seconds=1800 过期清除。

---

## E2E 验收

### GP-4 Step 3l：窗口形态不变量 + 梯度自愈 + skip 细分 + 队列过期（纯函数等价断言）

运行环境：windows_cloud（GitHub Actions windows-latest），追加到 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`。

```bash
# Step 3l：半死区修复三件套 + 队列过期 纯函数等价断言
python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

# --- L1：判群前窗口形态不变量纯函数 ---
fn = getattr(listen_chat, 'assert_window_shape_for_header', None)
assert fn is not None, 'FAIL: assert_window_shape_for_header 函数不存在'

# --- L2：梯度自愈触发函数 ---
heal_fn = getattr(listen_chat, 'should_heal_half_deadzone', None)
assert heal_fn is not None, 'FAIL: should_heal_half_deadzone 函数不存在'
assert heal_fn({'A': 3, 'B': 3}) is True, 'FAIL: 跨2 sender 应触发自愈'
assert heal_fn({'A': 3}) is False, 'FAIL: 单 sender 不触发自愈'
assert heal_fn({'A': 3, 'B': 3, 'C': 3}, threshold=3) is True, 'FAIL: 多 sender 均应触发'

# --- L3：skip reason 细分 ---
c = listen_chat._SkipCounter()
c.record('title_unreadable')
c.record('title_unreadable')
c.record('is_group')
snap = c.snapshot()
assert snap['total'].get('title_unreadable') == 2, 'FAIL: title_unreadable 计数不符，期望 2'
assert snap['total'].get('is_group') == 1, 'FAIL: is_group 计数不符，期望 1'

# --- L4：待发队列过期上限 ---
pending = {}
listen_chat.record_reply_failure(pending, sender='A', content='hi', reply='ok', now=0.0)
due = listen_chat.select_due_retries(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
assert 'A' not in due, 'FAIL: 超过 max_age_seconds 的条目不应出现在重试列表'

print('PASS: Step 3l 全部断言通过')
" && echo "Step 3l OK" || { echo "FAIL Step 3l"; exit 3; }
```

```bash
# grep 锚验证：关键实现符号必须落地
grep -q "assert_window_shape_for_header" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: assert_window_shape_for_header 未落地"; exit 3; }
grep -q "should_heal_half_deadzone" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: should_heal_half_deadzone 未落地"; exit 3; }
grep -q "title_unreadable" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: title_unreadable 未落地"; exit 3; }
grep -q "zj-deadzone-dump" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: zj-deadzone-dump dump 路径未落地"; exit 3; }
grep -q "enqueued_at" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: enqueued_at 过期字段未落地"; exit 3; }
echo "Step 3l grep 锚全部通过"
```

```bash
# rsync 同步校验：源文件与 build-modules 必须一致（L4 Runtime Gate）
diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ \
  --exclude="*.pyc" --exclude="__pycache__" \
  || { echo "FAIL Step 3l: wechat-rpa rsync 未同步"; exit 3; }
echo "Step 3l rsync 同步校验通过"
```

```bash
# version bump 校验
EXPECTED="1.0.150"
ACTUAL=$(python3 -c "import json; print(json.load(open('services/agent/modules/line04/manifest.json'))['version'])")
[ "$ACTUAL" = "$EXPECTED" ] \
  || { echo "FAIL Step 3l: manifest version 期望 $EXPECTED，实际 $ACTUAL"; exit 3; }
echo "Step 3l version bump 校验通过：$ACTUAL"
```

### 单测验收（CI vitest/pytest 门）

文件：`services/agent/wechat-rpa/tests/test_window_invariant.py`，本 sprint 新增 **7 case**：

| Case | 覆盖点 |
|------|--------|
| L1-1 | iconic=True → assert_window_shape_for_header 返回 False |
| L1-2 | zoomed=True + iconic=False → 返回 True |
| L1-3 | zoomed=False + iconic=False + 宽度<阈值 → 返回 False |
| L2-1 | counter={"A":3,"B":3} → should_heal_half_deadzone 返回 True |
| L2-2 | counter={"A":3} → 返回 False（单 sender 不触发） |
| L3-1 | 连续 3 次 title_unreadable → snapshot["total"]["title_unreadable"]==3 |
| L4-1 | enqueued_at 超过 1800s → 不出现在 select_due_retries 结果里 |

---

## 验收 PASS 判定

所有以下条件**同时**满足，合同 PASS：

1. `golden-path-4-smoke.sh` 新增 Step 3l 全部断言 `PASS`（python3 等价断言 + 5 个 grep 锚 + rsync diff + version bump）
2. `services/agent/wechat-rpa/tests/test_window_invariant.py` 新增 7 个 pytest case 全绿
3. `services/agent/modules/line04/manifest.json` 版本号 = `1.0.150`
4. `services/agent/build-modules/line04/manifest.json` 版本号 = `1.0.150`
5. `services/agent/wechat-rpa/listen_chat.py` 与 `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` diff 无差异
6. `services/agent/modules/line04/wechat-rpa/listen_chat.py` 同上

---

## 不在验收范围内

- 扫描态窗口体操重构（listen_chat.py:519-632）
- 腾讯新闻系统号过滤
- `/api/wechat/module-status` 新增接口
