---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: check-health.js 全平台扩展

**范围**: 扩展 PLATFORMS 至 35 条目（8×4=32 平台账号 + 3 API key）；重构 checkPlatform 输出 schema 为 PRD 规范；新增 sendFeishuAlert() + Promise.race 3s timeout；新增 SKIP_HTTP_CHECK 支持；session-health-report.json 改为 JSON array 格式
**大小**: M（~150 行净增）
**依赖**: 无

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

- [ ] [BEHAVIOR] check-health.js 输出 JSON array（非 `{ results: [...] }` 对象），包含 35 条目
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); if(!Array.isArray(d)){console.error(\"FAIL: 不是 array\");process.exit(1)}; if(d.length!==35){console.error(\"FAIL: length=\"+d.length+\" 期望35\");process.exit(1)}; console.log(\"OK: array length=35\")"'
  期望: OK: array length=35

- [ ] [BEHAVIOR] 每个条目 keys 完全等于 PRD 规范（`["checkedAt","expiresAt","platform","secretEnv","status"]`），无多余字段，无缺失字段
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const exp=JSON.stringify([\"checkedAt\",\"expiresAt\",\"platform\",\"secretEnv\",\"status\"]); const fail=d.find((item,i)=>{const act=JSON.stringify(Object.keys(item).sort()); if(act!==exp){console.error(\"FAIL item[\"+i+\"]: keys=\"+act);return true}}); if(fail)process.exit(1); console.log(\"OK: all keys match PRD\")"'
  期望: OK: all keys match PRD

- [ ] [BEHAVIOR] `status` 枚举值严格限于 `ok`/`expired`/`invalid`/`missing`（禁用 error/warning/healthy/good/bad/fail）
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const allowed=new Set([\"ok\",\"expired\",\"invalid\",\"missing\"]); const bad=d.filter((item,i)=>!allowed.has(item.status)); if(bad.length>0){console.error(\"FAIL: illegal status in\",bad.map(x=>x.status));process.exit(1)}; console.log(\"OK: all status valid\")"'
  期望: OK: all status valid

- [ ] [BEHAVIOR] 禁用字段 `name` 不出现在输出条目中（PRD 规定 platform 键名，禁用 name/label/account）
  Test: manual:bash -c 'SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js 2>/dev/null; node -e "const d=JSON.parse(require(\"fs\").readFileSync(\"session-health-report.json\",\"utf8\")); const hasForbidden=d.some(item=>item.name!==undefined||item.label!==undefined||item.account!==undefined); if(hasForbidden){console.error(\"FAIL: 禁用字段 name/label/account 出现\");process.exit(1)}; console.log(\"OK: no forbidden fields\")"'
  期望: OK: no forbidden fields

- [ ] [BEHAVIOR] `sendFeishuAlert` 使用 `Promise.race` + 3000ms 超时（飞书调用不阻塞 Bark）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(!s.includes(\"Promise.race\")){console.error(\"FAIL: 无 Promise.race\");process.exit(1)}; if(!s.match(/3[_\\s]*(?:000|\\*\\s*1000)/)){console.error(\"FAIL: 无 3000ms timeout 常量\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — JSON 解析失败时 status 为 `invalid`（非 PRD 禁用的 `error`）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(s.match(/status:\\s*[\"'"'"']error[\"'"'"']/)){console.error(\"FAIL: 仍使用禁用 status error\");process.exit(1)}; if(!s.match(/status:\\s*[\"'"'"']invalid[\"'"'"']/)){console.error(\"FAIL: 缺 status invalid\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] missing path — Secret 未配置时 status 为 `missing`（非 PRD 禁用的 `error` 或 `skip`）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\"); if(s.match(/status:\\s*[\"'"'"']skip[\"'"'"']/)){console.error(\"FAIL: 仍使用禁用 status skip\");process.exit(1)}; if(!s.match(/status:\\s*[\"'"'"']missing[\"'"'"']/)){console.error(\"FAIL: 缺 status missing\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK
