---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: GHA workflow default version → 1.1.31

**范围**: `.github/workflows/agent-e2e-video.yml` 的 `agent_version` input `default:` 从 `"1.1.30"` 改为 `"1.1.31"`（对齐 `services/agent/package.json` version=1.1.31）
**大小**: S（~3 行净增，1 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `agent-e2e-video.yml` 的 `default:` 字段值更新为 "1.1.31"
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/agent-e2e-video.yml','utf8');const m=c.match(/agent_version:[\s\S]*?default:\s*\"([^\"]+)\"/);if(!m){process.exit(1)}if(m[1]!=='1.1.31'){console.error('FAIL: default='+m[1]+' 非 1.1.31');process.exit(1)}console.log('ARTIFACT OK')"

## BEHAVIOR 条目

### BEHAVIOR 1: GHA default == agent package.json version（两者对齐）

- [ ] [BEHAVIOR] `.github/workflows/agent-e2e-video.yml` 的 `default:` 值等于 `services/agent/package.json` 的 `version`
  Test: manual:bash -c 'AGENT_VER=$(node -e "console.log(require(\"./services/agent/package.json\").version)") && GHA_VER=$(grep -m1 "default:" .github/workflows/agent-e2e-video.yml | sed "s/.*default: *\"\([^\"]*\)\".*/\1/" | tr -d " ") && echo "agent=$AGENT_VER gha=$GHA_VER" && [ "$AGENT_VER" = "$GHA_VER" ] || { echo "FAIL: 版本不匹配"; exit 1; } && echo OK'
  期望: OK

### BEHAVIOR 2: GHA default 具体值为 "1.1.31"（PRD 修正版本目标）

- [ ] [BEHAVIOR] GHA workflow default 明确等于 "1.1.31"（不是 1.1.30 或更低版本）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\",\"utf8\");const m=c.match(/default:\\s*\\\"([^\\\"]+)\\\"/);if(!m){console.error(\"FAIL: 找不到 default 字段\");process.exit(1);}if(m[1]!==\"1.1.31\"){console.error(\"FAIL: default=\"+m[1]+\" 非 1.1.31，当前仍是旧版\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 3: GHA default 不含旧版 1.1.30（禁用旧版反向检查）

- [ ] [BEHAVIOR] GHA workflow 中 agent_version input 的 `default:` 不再是 "1.1.30"
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\",\"utf8\");const m=c.match(/agent_version:[\\s\\S]*?default:\\s*\\\"([^\\\"]+)\\\"/);if(m&&m[1]===\"1.1.30\"){console.error(\"FAIL: default 仍是旧版 1.1.30\");process.exit(1);}console.log(\"OK\");"'
  期望: OK

### BEHAVIOR 4: error path — workflow 文件存在且含必要 key

- [ ] [BEHAVIOR] `agent-e2e-video.yml` 存在且含 `workflow_dispatch`、`agent_version`、`default:` 三个关键词
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/agent-e2e-video.yml\",\"utf8\");const keys=[\"workflow_dispatch\",\"agent_version\",\"default:\"];const missing=keys.filter(k=>!c.includes(k));if(missing.length){console.error(\"FAIL: 缺少 \"+missing.join(\", \"));process.exit(1);}console.log(\"OK\");"'
  期望: OK
