---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: E2E Smoke Test（E2E-First）

**范围**: `.github/workflows/scripts/smoke/acquisition-overview-smoke.sh` — 验收脚本，先于实现提交，定义"完成"条件
**大小**: S（~30 行）
**依赖**: 无（ws1 是第一个可独立完成的工作单元）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 脚本文件存在于正确路径
  Test: node -e "const fs=require('fs');if(!fs.existsSync('.github/workflows/scripts/smoke/acquisition-overview-smoke.sh'))process.exit(1);console.log('ok')"

- [ ] [ARTIFACT] smoke 脚本内容非空（≥ 10 行实质内容，非占位符 exit 0）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/acquisition-overview-smoke.sh','utf8');const lines=c.split('\\n').filter(l=>l.trim()&&!l.startsWith('#'));if(lines.length<10)process.exit(1);console.log('lines='+lines.length)"

- [ ] [ARTIFACT] smoke 脚本以正确 shebang 开头
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/acquisition-overview-smoke.sh','utf8');if(!c.startsWith('#!/'))process.exit(1);console.log('ok')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] smoke 脚本 bash 语法检查通过（不含语法错误）
  Test: manual:bash -c 'bash -n .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本验证 401 路径（无 license → 401 检查存在）
  Test: manual:bash -c 'grep -q "401" .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本包含 enabled 字段的 jq -e 断言
  Test: manual:bash -c 'grep -q "jq.*enabled" .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本包含 feature == "smart_acquisition" 的断言
  Test: manual:bash -c 'grep -q "smart_acquisition" .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本包含 keys 完整性检查（schema completeness）
  Test: manual:bash -c 'grep -q "keys ==" .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本包含禁用字段反向检查（至少检查 data 或 result 字段）
  Test: manual:bash -c 'grep -qE "has\(\"data\"\)|has\(\"result\"\)|has\(\"payload\"\)" .github/workflows/scripts/smoke/acquisition-overview-smoke.sh && echo OK'
  期望: OK
