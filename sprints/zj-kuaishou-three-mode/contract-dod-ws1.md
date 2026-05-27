---
skeleton: false
journey_type: autonomous
target_environment: windows_cloud
---
# Contract DoD — Workstream 1: publish-kuaishou-image-dryrun.cjs 三模式改造

**范围**: `services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs` 加 KUAISHOU_COOKIES（chromium.launch + addCookies）+ KUAISHOU_PROFILE_DIR（launchPersistentContext）两种新模式，保留 CDP connectOverCDP 兜底
**大小**: S（~90 行净增）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `publish-kuaishou-image-dryrun.cjs` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'); console.log('OK')"

- [ ] [ARTIFACT] 脚本含 KUAISHOU_COOKIES 环境变量读取
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');if(!c.includes('process.env.KUAISHOU_COOKIES'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 脚本含 KUAISHOU_PROFILE_DIR 环境变量读取
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');if(!c.includes('process.env.KUAISHOU_PROFILE_DIR'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 脚本含 `chromium.launch` 调用（cookie/profile 模式需要，区别于 connectOverCDP）
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');if(!c.includes('chromium.launch'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] KUAISHOU_COOKIES 模式分支存在于脚本（三模式选择逻辑）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs\",\"utf8\");if(!c.includes(\"KUAISHOU_COOKIES\")){console.error(\"FAIL: 无 KUAISHOU_COOKIES 分支\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] KUAISHOU_PROFILE_DIR 模式分支存在于脚本（launchPersistentContext 或等效调用）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs\",\"utf8\");if(!c.includes(\"KUAISHOU_PROFILE_DIR\")||!c.includes(\"launchPersistentContext\")){console.error(\"FAIL: 无 KUAISHOU_PROFILE_DIR/launchPersistentContext\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 脚本输出 JSON 含 `imagesCount` 字段（image-dryrun response schema 完整性）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs\",\"utf8\");if(!c.includes(\"imagesCount\")){console.error(\"FAIL: 输出无 imagesCount 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 输出 JSON 不含禁用字段 `result`（schema 禁用字段反向检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs\",\"utf8\");const m=c.match(/[\"'"'"'][result|status|data|payload][\"'"'"']\s*:/g)||[];const bad=m.filter(x=>x.match(/[\"'"'"'](result|status|data|payload)[\"'"'"']\s*:/));if(bad.length>0){console.error(\"FAIL: 禁用字段出现在输出中\",bad);process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — KUAISHOU_COOKIES 无效时脚本逻辑检测登录失败（含 login/passport URL 检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs\",\"utf8\");if(!c.includes(\"login\")||!c.includes(\"passport\")){console.error(\"FAIL: 脚本缺少登录失败检测逻辑\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
