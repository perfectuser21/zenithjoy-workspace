---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: Agent 版本 v1.1.30 + GHA workflow 更新

**范围**: `services/agent/package.json` version = `"1.1.30"`（修正 PRD 笔误：当前已是 1.1.29，目标为 1.1.30）；`agent-e2e-video.yml` 默认 `agent_version` 更新为 `"1.1.30"`；`agent-installpack.yml` 版本引用同步
**大小**: S（~15 行净增/改，3 文件）
**依赖**: Workstream 4 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/package.json` version 字段 = `"1.1.30"`
  Test: bash -c 'VER=$(cat services/agent/package.json | jq -r .version); [ "$VER" = "1.1.30" ] && echo OK || { echo "FAIL: version=$VER"; exit 1; }'

- [ ] [ARTIFACT] `.github/workflows/agent-e2e-video.yml` 含 `"1.1.30"` 字符串（default version 更新）
  Test: bash -c 'grep -q "1.1.30" .github/workflows/agent-e2e-video.yml && echo OK || { echo FAIL; exit 1; }'

---

## BEHAVIOR 条目（jq runtime oracle 优先）

- [ ] [BEHAVIOR] agent package.json version 精确等于 "1.1.30"，不是 "1.1.29" 或其他（jq runtime oracle）
  Test: manual:bash -c 'VER=$(cat services/agent/package.json | jq -r .version 2>/dev/null); [ "$VER" = "1.1.30" ] || { echo "FAIL: version=$VER 期望 1.1.30"; exit 1; }; echo "OK version=$VER"'
  期望: OK version=1.1.30

- [ ] [BEHAVIOR] agent-e2e-video.yml 中 default agent_version 值为 "1.1.30"（防止 Final E2E 仍测旧包）
  Test: manual:bash -c 'M=$(grep -E "default:" .github/workflows/agent-e2e-video.yml | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1); [ "$M" = "1.1.30" ] || { echo "FAIL: GHA default version=$M 期望 1.1.30"; exit 1; }; echo "OK default=$M"'
  期望: OK default=1.1.30

- [ ] [BEHAVIOR] GHA workflow 中不含硬编码旧版本 "1.1.29" 作为唯一目标版本
  Test: manual:bash -c 'F=".github/workflows/agent-e2e-video.yml"; OLD=$(grep -c "1\.1\.29" "$F" 2>/dev/null || echo 0); NEW=$(grep -c "1\.1\.30" "$F" 2>/dev/null || echo 0); if [ "$OLD" -gt 0 ] && [ "$NEW" -eq 0 ]; then echo "FAIL: 仍含旧版本 1.1.29 且无 1.1.30"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] package.json version 字段是 string 类型（jq type 检查）
  Test: manual:bash -c 'TYPE=$(cat services/agent/package.json | jq -r '"'"'.version | type'"'"' 2>/dev/null); [ "$TYPE" = "string" ] || { echo "FAIL: version type=$TYPE 期望 string"; exit 1; }; echo "OK type=$TYPE"'
  期望: OK type=string

- [ ] [BEHAVIOR] agent-installpack.yml 若引用版本号，不含 "1.1.29" 作为唯一版本（向后兼容检查）
  Test: manual:bash -c 'F=".github/workflows/agent-installpack.yml"; [ -f "$F" ] || { echo "OK: file not found, skip"; exit 0; }; OLD=$(grep -c "1\.1\.29" "$F" || echo 0); NEW=$(grep -c "1\.1\.30" "$F" || echo 0); if [ "$OLD" -gt 0 ] && [ "$NEW" -eq 0 ]; then echo "FAIL: installpack.yml 引用 1.1.29 但无 1.1.30"; exit 1; fi; echo OK'
  期望: OK
