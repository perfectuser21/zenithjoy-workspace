---
skeleton: false
journey_type: autonomous
target_environment: windows_cloud
---
# Contract DoD — Workstream 2: publish-kuaishou-video-dryrun.cjs 新建（三模式）

**范围**: 新建 `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`，复用 image-dryrun 三模式框架（KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR + CDP 兜底），导航目标改为 `https://cp.kuaishou.com/article/publish/video`，输出 JSON 只含 4 字段（无 imagesCount）
**大小**: M（~150 行新建）
**依赖**: Workstream 1（ws1 完成后执行，保证串行评估）

## ARTIFACT 条目

- [ ] [ARTIFACT] `publish-kuaishou-video-dryrun.cjs` 文件已创建
  Test: node -e "require('fs').accessSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'); console.log('OK')"

- [ ] [ARTIFACT] 脚本含视频发布页 URL `https://cp.kuaishou.com/article/publish/video`
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');if(!c.includes('cp.kuaishou.com/article/publish/video'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 脚本含三模式选择逻辑（KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR + CDP）
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs','utf8');if(!c.includes('KUAISHOU_COOKIES')||!c.includes('KUAISHOU_PROFILE_DIR'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 脚本输出 JSON `ok` 字段值 true（video-dryrun success schema 字段验证）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs\",\"utf8\");if(!c.includes(\"ok: true\")){console.error(\"FAIL: 输出无 ok:true\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 脚本输出 JSON `dryRun` 字段值 true（schema 完整性）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs\",\"utf8\");if(!c.includes(\"dryRun: true\")){console.error(\"FAIL: 输出无 dryRun:true\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 脚本输出 JSON 不含 `imagesCount` 字段（video schema keys 完整性 — video 只有 4 字段 `{ok,dryRun,url,title}`，区别于 image 的 5 字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs\",\"utf8\");const lines=c.split(\"\\n\").filter(l=>l.includes(\"imagesCount\"));if(lines.length>0){console.error(\"FAIL: video-dryrun 输出含 imagesCount（应无此字段）\",lines[0]);process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 `result`/`status`/`data`/`payload` 不出现在输出 JSON keys（schema 禁用字段反向检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs\",\"utf8\");[\"result\",\"status\",\"data\",\"payload\"].forEach(f=>{const re=new RegExp(\"[\\x27\\x22]\"+f+\"[\\x27\\x22]\\\\s*:\");if(re.test(c)){console.error(\"FAIL: 禁用字段\",f,\"在输出 key 中\");process.exit(1);}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — 脚本含登录失败检测（URL 含 login/passport 时 exit 1）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs\",\"utf8\");if(!c.includes(\"login\")||!c.includes(\"passport\")){console.error(\"FAIL: 脚本缺少登录失败 URL 检测\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
