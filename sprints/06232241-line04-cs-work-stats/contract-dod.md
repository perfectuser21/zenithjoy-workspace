---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: 客服工作汇总统计页（每客服每日 4 数 + 今天/昨天）

**范围**: cs_memory_messages 加 nullable `cs_wechat_id` + 索引；in/out 落库盖客服身份章；`GET /api/wechat/cs/stats` 按北京时区每客服聚合 4 数；前台「客服工作汇总」页（每客服一张卡 + 今天/昨天切换，挂 Line04 区）。
**大小**: M

> oracle 前提：`apps/api` 起在 `$API_BASE`、`$ZENITHJOY_INTERNAL_TOKEN` 一致、`$DATABASE_URL` 指向已跑本 sprint migration 的 zenithjoy Postgres。所有 [BEHAVIOR] 命令真 seed→真 curl/POST→`jq -e`/`psql` 时间窗断言，非 mock、非 echo 假绿。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 新增 cs_wechat_id nullable 列 + (cs_wechat_id, created_at) 索引
  Test: node -e "const fs=require('fs');const g=require('child_process').execSync('ls apps/api/db/migrations').toString();const f=g.split('\n').filter(x=>/cs_wechat_id|cs_stats|cs_work/i.test(x));if(!f.length)process.exit(1);const c=f.map(x=>fs.readFileSync('apps/api/db/migrations/'+x,'utf8')).join('\n');if(!/cs_wechat_id/.test(c)||!/cs_wechat_id[\s\S]*created_at|created_at[\s\S]*cs_wechat_id/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 前台「客服工作汇总」页 + 路由 + Line04 导航入口
  Test: node -e "const fs=require('fs');const p=require('child_process').execSync('ls apps/dashboard/src/pages').toString();if(!/CsWorkStats|cs-work-stats|客服工作汇总/i.test(p))process.exit(1);const nav=fs.readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!/cs-?stats|cs-?work-?stats|客服工作汇总/i.test(nav))process.exit(1)"

- [ ] [ARTIFACT] Playwright E2E spec + windows_cloud 运行脚本存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('apps/dashboard/e2e/cs-work-stats.spec.ts'))process.exit(1);if(!fs.existsSync('sprints/06232241-line04-cs-work-stats/scripts/e2e-verify.ps1'))process.exit(1)"

## BEHAVIOR 条目（journey_type=user_facing｜模式A：API/DB-level，evaluator 跑）

> 数据口径正确性走真 API+DB 数据 oracle `scripts/cs-stats-verify.sh`（逻辑断言，环境无关，CI/psql-seed 绿 = 真 done）。

- [ ] [BEHAVIOR] migration 后 cs_wechat_id 列 nullable + (cs_wechat_id, created_at) 索引存在
  Test: manual:bash -c 'psql "$DATABASE_URL" -t -A -c "SELECT is_nullable FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'cs_memory_messages'"'"' AND column_name='"'"'cs_wechat_id'"'"'" | grep -qx YES || { echo FAIL-col; exit 1; }; psql "$DATABASE_URL" -t -A -c "SELECT 1 FROM pg_indexes WHERE schemaname='"'"'zenithjoy'"'"' AND tablename='"'"'cs_memory_messages'"'"' AND indexdef ILIKE '"'"'%cs_wechat_id%created_at%'"'"'" | grep -qx 1 || { echo FAIL-idx; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] stats 4 数口径精确（received=3 reply=2 served=2 minutes=20）+ 字段名锁定 + 禁用字段反向
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh math
  期望: PASS math

- [ ] [BEHAVIOR] 数据隔离：A=3 / B=1 互不串台（A 的数绝不进 B 卡）
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh isolation
  期望: PASS isolation

- [ ] [BEHAVIOR] 老数据兼容：cs_wechat_id=NULL 不计入任何客服、接口不报错
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh null
  期望: PASS null

- [ ] [BEHAVIOR] 北京时区日界：北京今天 00:30（美区当时昨天）归「今天」、不串昨天（防 #832）
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh tz
  期望: PASS tz

- [ ] [BEHAVIOR] 昨天聚合正确（昨天=1/1）、今天的客服不串昨天
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh yesterday
  期望: PASS yesterday

- [ ] [BEHAVIOR] 边界：无消息日 stats 接口不报错、返回 {ok:true, stats:[...]} 数组
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh empty-zero
  期望: PASS empty-zero

- [ ] [BEHAVIOR] error path — date 非 today/yesterday → HTTP 400 + error 字段为字符串
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/cs-err.json -w "%{http_code}" "${API_BASE:-http://localhost:5210}/api/wechat/cs/stats?date=garbage" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 date 未返 400，得 $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/cs-err.json || { echo FAIL-error-field; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR][接缝#1] in 落库经真身份链盖 cs_wechat_id（真 /draft-generate，非 mock）
  Test: manual:bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh stamp
  期望: PASS stamp
  备注: out 行盖章依赖 LLM（OpenRouter key）→ CI 无 key 时 out=0 属正常，标 logic-done-pending，需真目标（带 key 的栈）补验 in+out 全程。in 行盖章 LLM 无关，此处硬验。

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e — windows_cloud Playwright）

- [ ] [BEHAVIOR:E2E] 用户走完 Golden Path：打开「客服工作汇总」→ 每客服一张卡 4 数正确 → 切「昨天」数字变化，截图自验
  Run: sprints/06232241-line04-cs-work-stats/scripts/e2e-verify.ps1（windows-latest，page.route 拦 /api/wechat/cs/stats）
  Spec: apps/dashboard/e2e/cs-work-stats.spec.ts
  Screenshots:
    - 01-initial.png   期望：「客服工作汇总」页初始（今天）≥2 张客服卡可见，A 卡显示 received=3/reply=2/served=2/minutes=20，B 卡 received=1（A 的数不在 B 卡）；0 消息客服卡四数均 0
    - 02-action.png    期望：点「昨天」标签后过渡态，正在重新请求 date=yesterday
    - 03-result.png    期望：昨天数据渲染完成，A 卡 received 由 3 变为 1（mock 昨天响应），数字确实变化
  路径格式：sprints/06232241-line04-cs-work-stats/screenshots/<step>.png
  期望：Playwright spec 全绿（toHaveText 精确匹配 + 切换后数字变化 + 不串台 + 空卡 4 零），evaluator Read 截图自验通过
