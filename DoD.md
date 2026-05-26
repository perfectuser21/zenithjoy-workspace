contract_branch: main
workstream_index: 4
sprint_dir: sprints/zj-ops1-session-health

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: CI session-health-check.yml 扩展 + smoke 脚本

**范围**: `.github/workflows/session-health-check.yml` env 段注入全部 35 个平台 Secrets（DOUYIN_MAIN ~ WECOM_API_KEY）+ FEISHU_BOT_WEBHOOK；新建 `.github/workflows/scripts/smoke/session-health-smoke.sh`；新建 `sprints/zj-ops1-session-health/e2e-verify.ps1`
**大小**: S（~100 行净增）
**依赖**: Workstream 3 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 文件存在且含 35 条 secretEnv 定义
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/check-health.js','utf8'); const n=(s.match(/secretEnv:/g)||[]).length; if(n<35){console.error('FAIL: secretEnv count='+n+' <35');process.exit(1)}; console.log('OK: count='+n)"

- [ ] [ARTIFACT] PLATFORMS 数组覆盖全部 8 个平台（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）及 3 个 API key
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/check-health.js','utf8'); const p=['KUAISHOU','XIAOHONGSHU','SHIPINHAO','TOUTIAO','WEIBO','ZHIHU','GONGZHONGHAO','FEISHU_API_KEY','NOTION_API_KEY','WECOM_API_KEY']; const miss=p.filter(x=>!s.includes(x)); if(miss.length>0){console.error('FAIL:',miss);process.exit(1)}; console.log('OK')"

- [ ] [ARTIFACT] `sendFeishuAlert` 函数存在（新增飞书双渠道告警）
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/check-health.js','utf8'); if(!s.includes('sendFeishuAlert')){console.error('FAIL: 无 sendFeishuAlert');process.exit(1)}; console.log('OK')"

- [ ] [ARTIFACT] `SKIP_HTTP_CHECK` 环境变量支持存在（CI 离线环境保护）
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/check-health.js','utf8'); if(!s.includes('SKIP_HTTP_CHECK')){console.error('FAIL: 无 SKIP_HTTP_CHECK');process.exit(1)}; console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] check-health.js 输出 JSON array（非对象），包含 35 条目
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); if(!Array.isArray(d)){console.error(\"FAIL: 不是 array\");process.exit(1)}; if(d.length!==35){console.error(\"FAIL: length=\"+d.length+\" 期望35\");process.exit(1)}; console.log(\"OK: array length=35\")"'
  期望: OK: array length=35

- [ ] [BEHAVIOR] 每个条目 keys 完全等于 PRD 规范（checkedAt/expiresAt/platform/secretEnv/status）
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const exp=JSON.stringify([\"checkedAt\",\"expiresAt\",\"platform\",\"secretEnv\",\"status\"]); const fail=d.find((item,i)=>{const act=JSON.stringify(Object.keys(item).sort()); if(act!==exp){console.error(\"FAIL item[\"+i+\"]: keys=\"+act);return true}}); if(fail)process.exit(1); console.log(\"OK: all keys match PRD\")"'
  期望: OK: all keys match PRD

- [ ] [BEHAVIOR] status 枚举值严格限于 ok/expired/invalid/missing
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const allowed=new Set([\"ok\",\"expired\",\"invalid\",\"missing\"]); const bad=d.filter(item=>!allowed.has(item.status)); if(bad.length>0){console.error(\"FAIL: illegal status\",bad.map(x=>x.status));process.exit(1)}; console.log(\"OK: all status valid\")"'
  期望: OK: all status valid

- [ ] [BEHAVIOR] sendFeishuAlert 使用 Promise.race + 3000ms 超时
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(!s.includes(\"Promise.race\")){console.error(\"FAIL: 无 Promise.race\");process.exit(1)}; if(!s.match(/3[_\s]*(?:000|\*\s*1000)/)){console.error(\"FAIL: 无 3000ms\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] JSON 解析失败时 status 为 invalid
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(s.match(/status:\s*[\"'"'"']error[\"'"'"']/)){console.error(\"FAIL: 仍使用禁用 error\");process.exit(1)}; if(!s.match(/status:\s*[\"'"'"']invalid[\"'"'"']/)){console.error(\"FAIL: 缺 invalid\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] Secret 未配置时 status 为 missing
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(s.match(/status:\s*[\"'"'"']skip[\"'"'"']/)){console.error(\"FAIL: 仍使用禁用 skip\");process.exit(1)}; if(!s.match(/status:\s*[\"'"'"']missing[\"'"'"']/)){console.error(\"FAIL: 缺 missing\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] API key 条目 expiresAt 为 null
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const apiKeys=d.filter(x=>x.secretEnv.includes(\"_API_KEY\")); if(apiKeys.length<3){console.error(\"FAIL: API_KEY 条目 <3\");process.exit(1)}; const bad=apiKeys.filter(x=>x.expiresAt!==null); if(bad.length>0){console.error(\"FAIL: expiresAt 非 null\",bad.map(x=>x.secretEnv));process.exit(1)}; console.log(\"OK: \"+apiKeys.length+\" 个 API_KEY expiresAt 均为 null\")"'
  期望: OK: 3 个 API_KEY 条目 expiresAt 均为 null
