# Contract DoD — W5 D5：two-column-gate.sh + selftest + promote 接线

**TASK_ID**: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af
**Sprint**: W5-放行闸第三证据项双表绿(验收一体两面D5)
**DoD 版本**: v1.0（首轮）

---

## 真机边界声明

**本 sprint 零真机、零 UI。**
本 sprint 唯一执行环境：GitHub Actions ubuntu-latest（标准托管 runner），无 self-hosted、无安卓设备、无浏览器操作。

---

## INVARIANT 断言覆盖

### [INV-1-ASSERT] 三证据累积不替换

**对应**: `INVARIANT-1`（证据③仅新增，不替换证据①②；三证据全部通过才允许 promote-backend 继续）

**验收断言**:
```
promote-all-prod.yml release-gate job 中：
- 证据① step（staging 绿）存在且未被删除
- 证据② step（nightly 最近2晚绿）存在且未被删除
- 证据③ step（two-column gate）新增在证据②之后，:138 行起
- promote-backend job 的 needs 包含 release-gate，无旁路
```

**验收命令**:
```bash
grep -c "证据" .github/workflows/promote-all-prod.yml
# 期望 >= 3（含③）
grep "needs:.*release-gate" .github/workflows/promote-all-prod.yml
# 期望匹配到 promote-backend
```

---

### [INV-2-ASSERT] bypass 仅在 infra_error 生效

**对应**: `INVARIANT-2`（bypass_two_column_infra 只在 ai_run_infra_error 时生效；cells_red 时即使 bypass=true 也必须 exit 1）

**验收断言**:
```
fixture: {blocked_reason: "undecided_cells", bypass_two_column_infra: true}
→ two-column-gate.sh exit 1

fixture: {blocked_reason: null, bypass_two_column_infra: true}
→ two-column-gate.sh exit 1

fixture: {blocked_reason: "ai_run_infra_error", bypass_two_column_infra: true}
→ two-column-gate.sh exit 0
```

---

### [INV-3-ASSERT] 棘轮超限阻止

**对应**: `INVARIANT-3`（四项近 30 天 > 3 次时 exit 1 + summary 大字，不允许静默放行）

**验收断言**:
```
fixture 中 ratchet.bypass_count = 4（> 3）
→ two-column-gate.sh exit 1
→ GITHUB_STEP_SUMMARY 含棘轮超限字样
```

---

### [INV-4-ASSERT] 双 sha 字节精确匹配

**对应**: `INVARIANT-4`（run.backend_sha 必须与输入 PROMOTE_SHA 字节相等，不允许前缀截断）

**验收断言**:
```
PROMOTE_SHA=abc123def456（完整40位）
fixture.backend_sha=abc123def456（完整40位，匹配）→ exit 0

PROMOTE_SHA=abc123def456
fixture.backend_sha=abc123（截断，不匹配）→ exit 1

PROMOTE_SHA=abc123def456
fixture.backend_sha=abc123def789（末位不同）→ exit 1
```

---

### [INV-5-ASSERT] promote-dashboard sha 来源一致

**对应**: `INVARIANT-5`（dashboard sha 与 backend 来自同一 input，不允许漂移至 origin/main HEAD）

**验收断言**:
```
promote-all-prod.yml promote-dashboard job：
- 若 inputs.sha 非空：git reset --hard "${{ github.event.inputs.sha }}"
- git reset --hard origin/main 仅在 inputs.sha 为空时执行（或改为条件分支）
```

**验收命令**:
```bash
grep -A5 "git reset" .github/workflows/promote-all-prod.yml | grep -E "inputs.sha|event.inputs.sha"
# 期望命中 promote-dashboard job 中的 sha 读取行
```

---

### [INV-6-ASSERT] secrets 不泄漏

**对应**: `INVARIANT-6`（GATE_TOKEN 不硬编码、不进日志、不进 git）

**验收断言**:
```
grep -r "GATE_TOKEN" scripts/release-gate/two-column-gate.sh
# 仅含 $GATE_TOKEN 变量引用，不含 token 字符串字面量

grep -r "GATE_TOKEN" .github/workflows/promote-all-prod.yml
# 仅含 secrets.GATE_TOKEN 引用

git log --all --diff-filter=A -- "*.env" "*.key" "*.pem"
# 无输出（无凭据文件）
```

---

## [BEHAVIOR] 行为断言列表

[BEHAVIOR] 当 gate_verdict == "green" 且 backend_sha 精确匹配 PROMOTE_SHA 时，two-column-gate.sh exit 0
[BEHAVIOR] 当 gate_verdict != "green" 或 backend_sha 不匹配时，two-column-gate.sh exit 1
[BEHAVIOR] 当 blocked_reason == "ai_run_infra_error" 且 bypass_two_column_infra=true 时，exit 0（infra bypass 生效）
[BEHAVIOR] 当 blocked_reason == "undecided_cells" 时，即使 bypass_two_column_infra=true 仍 exit 1（bypass 不生效）
[BEHAVIOR] 当 gate 端点不可达时（取数失败，fixture 文件不存在或 HTTP 错误），exit 1
[BEHAVIOR] 当任一棘轮计数近30天 > 3 时，exit 1 并在 GITHUB_STEP_SUMMARY 输出棘轮超限摘要

**覆盖说明**：

| 编号 | 对应行为断言 | 验收方式 |
|------|-------------|----------|
| B-1 | gate_verdict green + sha 匹配 → exit 0 | fixture case-green.json |
| B-2 | gate_verdict 非 green 或 sha 不匹配 → exit 1 | fixture case-not-finalized.json |
| B-3 | infra_error + bypass=true → exit 0 | fixture case-infra-error-bypass.json |
| B-4 | cells_red + bypass=true → exit 1（bypass 无效） | fixture case-cells-red-bypass.json |
| B-5 | 取数失败 → exit 1 | fixture nonexistent.json（文件不存在） |
| B-6 | 棘轮 > 3 → exit 1 + summary | fixture ratchet.bypass_count=4 |

---

## manual:bash 可执行验收命令

```bash
# ========================================================
# manual:bash — W5 D5 contract 本地可执行验收命令
# 前置：bash + jq 已安装（ubuntu-latest 标准环境）
# ========================================================

SCRIPT="scripts/release-gate/two-column-gate.sh"
FIXTURE_DIR="scripts/release-gate/fixtures"
PROMOTE_SHA="aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee"

# --- 情形1：未定案 → exit 1 ---
RESULT=$(bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-not-finalized.json" \
  PROMOTE_SHA="$PROMOTE_SHA" 2>&1; echo "EXIT:$?")
echo "$RESULT" | grep "EXIT:1" && echo "[PASS] 情形1: 未定案 exit 1" \
  || echo "[FAIL] 情形1: 期望 exit 1"

# --- 情形2：定案绿 + sha 匹配 → exit 0 ---
RESULT=$(bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-green.json" \
  PROMOTE_SHA="$PROMOTE_SHA" 2>&1; echo "EXIT:$?")
echo "$RESULT" | grep "EXIT:0" && echo "[PASS] 情形2: 定案绿 exit 0" \
  || echo "[FAIL] 情形2: 期望 exit 0"

# --- 情形3：取数失败（fixture 不存在模拟不可达）→ exit 1 ---
RESULT=$(bash "$SCRIPT" --fixture "$FIXTURE_DIR/nonexistent.json" \
  PROMOTE_SHA="$PROMOTE_SHA" 2>&1; echo "EXIT:$?")
echo "$RESULT" | grep "EXIT:1" && echo "[PASS] 情形3: 取数失败 exit 1" \
  || echo "[FAIL] 情形3: 期望 exit 1"

# --- 情形4：infra_error + bypass=true → exit 0 ---
RESULT=$(bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-infra-error-bypass.json" \
  PROMOTE_SHA="$PROMOTE_SHA" bypass_two_column_infra=true 2>&1; echo "EXIT:$?")
echo "$RESULT" | grep "EXIT:0" && echo "[PASS] 情形4: infra_error+bypass exit 0" \
  || echo "[FAIL] 情形4: 期望 exit 0"

# --- INVARIANT-2 补充：cells_red + bypass=true → exit 1 ---
RESULT=$(bash "$SCRIPT" --fixture "$FIXTURE_DIR/case-cells-red-bypass.json" \
  PROMOTE_SHA="$PROMOTE_SHA" bypass_two_column_infra=true 2>&1; echo "EXIT:$?")
echo "$RESULT" | grep "EXIT:1" && echo "[PASS] INV-2: cells_red 忽略 bypass exit 1" \
  || echo "[FAIL] INV-2: 期望 exit 1（bypass 不生效）"

# --- yaml lint（promote-all-prod.yml）---
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/promote-all-prod.yml'))" \
  && echo "[PASS] promote-all-prod.yml yaml 语法有效" \
  || echo "[FAIL] yaml 语法错误"

# --- INV-6: secrets 不硬编码 ---
grep -E "ghp_|token_" scripts/release-gate/two-column-gate.sh \
  && echo "[FAIL] INV-6: 发现 token 字面量" \
  || echo "[PASS] INV-6: 无 token 字面量"
```

---

## 完成标准（Definition of Done）

- [ ] `scripts/release-gate/two-column-gate.sh` 新建，包含：--fixture 模式 / sha 断言 / verdict 断言 / blocked_reason 三态 / 棘轮计数
- [ ] `scripts/release-gate/fixtures/` 四个 fixture JSON（case-not-finalized / case-green / case-infra-error-bypass / case-cells-red-bypass）
- [ ] `.github/workflows/two-column-gate-selftest.yml` 新建，四情形全部符合预期退出码
- [ ] `.github/workflows/promote-all-prod.yml` 在 :138 后新增证据③ step
- [ ] `.github/workflows/promote-all-prod.yml` promote-dashboard job 改读 inputs.sha
- [ ] 六条 INVARIANT 全部有对应断言（见上文）
- [ ] manual:bash 命令在本地 bash+jq 环境可执行
- [ ] GATE_TOKEN 仅以 `$GATE_TOKEN` 变量形式引用，不进 git
- [ ] PR 标题带 [CONFIG]，CI 全绿
