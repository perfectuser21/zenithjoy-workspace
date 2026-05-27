---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: check-health.js 修复 + GHA YAML 同步 + smoke script

**范围**: `scripts/sessions/check-health.js` secretEnv `*_MAIN→*_COOKIES`（8 主号）+ missing=ok bug 修复 + `.github/workflows/session-health-check.yml` Secret 引用同步 + 新建 `session-health-medium-smoke.sh`
**大小**: S（~80 行，3 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/sessions/check-health.js` 文件存在且不含任何 `secretEnv: 'DOUYIN_MAIN'`/`'KUAISHOU_MAIN'` 等 `*_MAIN` 形式的主号 secretEnv 赋值
  Test: node -e "const c=require('fs').readFileSync('scripts/sessions/check-health.js','utf8');if(c.match(/secretEnv:.*'[A-Z]+_MAIN'/))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/session-health-check.yml` 文件存在且含 `DOUYIN_COOKIES:` 引用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8');if(!c.includes('DOUYIN_COOKIES:'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/session-health-medium-smoke.sh` 文件存在且 ≥5 行实质内容
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/session-health-medium-smoke.sh','utf8');if(c.split('\n').filter(l=>l.trim()&&!l.startsWith('#')).length<5)process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] check-health.js 8 个主号平台 secretEnv 全部使用 `*_COOKIES` 命名（无 `*_MAIN`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");const m=c.match(/secretEnv:[\x27\"]([A-Z]+_MAIN)[\x27\"]/g);if(m){console.error(\"FAIL: 仍含\",m);process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] check-health.js 含 `DOUYIN_COOKIES`、`KUAISHOU_COOKIES`、`XIAOHONGSHU_COOKIES` 三条主号条目
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");const required=[\"DOUYIN_COOKIES\",\"KUAISHOU_COOKIES\",\"XIAOHONGSHU_COOKIES\"];for(const k of required){if(!c.includes(k)){console.error(\"FAIL: 缺少\",k);process.exit(1);}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GHA YAML 含 8 个 `*_COOKIES:` 引用（覆盖全部平台主号）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\");const keys=[\"DOUYIN_COOKIES\",\"KUAISHOU_COOKIES\",\"XIAOHONGSHU_COOKIES\",\"SHIPINHAO_COOKIES\",\"TOUTIAO_COOKIES\",\"WEIBO_COOKIES\",\"ZHIHU_COOKIES\",\"GONGZHONGHAO_COOKIES\"];let fail=false;for(const k of keys){if(!c.includes(k+\":\")){console.error(\"FAIL: 缺少\",k);fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] check-health.js 在 `SKIP_HTTP_CHECK=true` + 对应环境变量为空时，对应平台 status 为 `missing`（修复 missing=ok bug）— 通过源码验证存在非空检查逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"scripts/sessions/check-health.js\",\"utf8\");if(!c.includes(\"missing\")){{console.error(\"FAIL: 缺少 missing status\");process.exit(1);}}if(!c.includes(\"!raw\")||!c.includes(\"missing\")){{console.error(\"FAIL: 空值检查逻辑缺失\");process.exit(1);}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] smoke script 含 `SKIP_HTTP_CHECK=true` 调用 check-health.js 并验证输出不含 `_MAIN` 字符串
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/scripts/smoke/session-health-medium-smoke.sh\",\"utf8\");if(!c.includes(\"SKIP_HTTP_CHECK\")){{console.error(\"FAIL: 缺少 SKIP_HTTP_CHECK\");process.exit(1);}}if(!c.includes(\"check-health\")){{console.error(\"FAIL: 缺少 check-health 调用\");process.exit(1);}}console.log(\"OK\")"'
  期望: OK
