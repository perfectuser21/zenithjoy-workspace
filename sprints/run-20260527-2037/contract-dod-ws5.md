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
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8'));if(p.version!=='1.1.30')process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/agent-e2e-video.yml` 含 `"1.1.30"` 字符串（default version 更新）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');if(!c.includes('1.1.30'))process.exit(1)"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] agent package.json version 精确等于 "1.1.30"（不是 1.1.29 或其他）
  Test: manual:bash -c 'node -e "const p=JSON.parse(require(\"fs\").readFileSync(\"services/agent/package.json\",\"utf8\"));if(p.version!==\"1.1.30\"){console.error(\"FAIL: version=\"+p.version+\" 期望 1.1.30\");process.exit(1)}console.log(\"OK version=\"+p.version)"'
  期望: OK version=1.1.30

- [ ] [BEHAVIOR] agent-e2e-video.yml 中 default agent_version 值为 "1.1.30"（防止 E2E 仍测旧包）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\",\"utf8\");const m=c.match(/default:\\s*[\"'"'"']?([\\d.]+)[\"'"'"']?/);if(!m){console.error(\"FAIL: 未找到 default version\");process.exit(1)}if(m[1]!==\"1.1.30\"){console.error(\"FAIL: GHA default version=\"+m[1]+\" 期望 1.1.30\");process.exit(1)}console.log(\"OK default=\"+m[1])"'
  期望: OK default=1.1.30

- [ ] [BEHAVIOR] E2E spec 或 GHA workflow 中不含硬编码旧版本 "1.1.29" 作为目标版本
  Test: manual:bash -c 'node -e "const e=require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\",\"utf8\");if(e.includes(\"default: \\\"1.1.29\\\"\")||e.includes(\"default: 1.1.29\")){console.error(\"FAIL: GHA 仍有旧版本 1.1.29\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] services/agent/package.json version 字段是 string 类型，不是 number
  Test: manual:bash -c 'node -e "const p=JSON.parse(require(\"fs\").readFileSync(\"services/agent/package.json\",\"utf8\"));if(typeof p.version!==\"string\"){console.error(\"FAIL: version 不是 string\");process.exit(1)}console.log(\"OK type=string\")"'
  期望: OK type=string

- [ ] [BEHAVIOR] agent-installpack.yml 若引用版本号，不含 "1.1.29" 作为唯一版本（应为 1.1.30 或无固定版本）
  Test: manual:bash -c 'F=".github/workflows/agent-installpack.yml"; [ -f "$F" ] || { echo "OK: file not found, skip"; exit 0; }; node -e "const c=require(\"fs\").readFileSync(\"$F\",\"utf8\");const m=c.match(/1\\.1\\.29/g)||[];if(m.length>0&&!c.includes(\"1.1.30\")){console.error(\"FAIL: installpack.yml 引用 1.1.29 但无 1.1.30\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
