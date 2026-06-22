---
skeleton: false
journey_type: agent_remote
target_environment: windows_wechat
---
# Contract DoD — Sprint: 微信客服 无审批自动回复闭环（Line 04）

**范围**: 名单内无审批自动回（拟人 1~5s 延迟 + 真送达）、名单外记 pending_human、「开启自动代理」总开关（OFF=监控态出草稿不发）、营业时间窗口（含跨午夜）、关键人配置、开关跳变上下线播报、DB CHECK 放开容 system + 新状态 auto_sent/pending_human、去重/超时/daily_limit/失败告警等 NFR。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] auto_reply.py 纯决策模块存在且导出核心函数
  Test: python3 -c "import sys; sys.path.insert(0,'services/agent/wechat-rpa'); import auto_reply as m; [getattr(m,n) for n in ('decide_reply_route','within_business_hours','pick_reply_delay','is_duplicate','broadcast_action','alert_on_failure')]"

- [ ] [ARTIFACT] DB 迁移文件存在且对 wechat_publish_task 两个 CHECK 做 DROP/ADD（含新状态 auto_sent + pending_human）
  Test: node -e "const fs=require('fs'),d='apps/api/db/migrations';const ok=fs.readdirSync(d).some(x=>x.endsWith('.sql')&&/auto_sent/.test(fs.readFileSync(d+'/'+x,'utf8'))&&/pending_human/.test(fs.readFileSync(d+'/'+x,'utf8'))&&/approval_source/.test(fs.readFileSync(d+'/'+x,'utf8')));process.exit(ok?0:1)"

- [ ] [ARTIFACT] 配置存取层新增自动代理 5 键的读写函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat/cs-config-store.ts','utf8');if(!/auto_agent_enabled/.test(c)||!/business_hours_start/.test(c)||!/key_contact_wechat/.test(c))process.exit(1)"

- [ ] [ARTIFACT] auto-mode smoke 扩展覆盖三态+名单外+回执+播报+去重+告警
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh','utf8');for(const k of ['pending_human','auto_sent','broadcast']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual:bash，agent_remote 逻辑层走 CI；接缝层走 e2e-verify.ps1）

- [ ] [BEHAVIOR] 路由真值表 5 行字面量正确（auto/review/pending_human/skip_offhours）
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "route_auto or route_review or route_pending_human or route_skip_offhours" && echo OK'
  期望: OK（pytest exit 0）

- [ ] [BEHAVIOR] route 取值 ⊆ 4 字面量，禁用同义词不出现（反向断言）
  Test: manual:bash -c 'python3 -c "import sys;sys.path.insert(0,\"services/agent/wechat-rpa\");import auto_reply as m;vals={m.decide_reply_route(a,b,c,0,0) for a in (True,False) for b in (True,False) for c in (True,False)};assert vals <= {\"auto\",\"review\",\"pending_human\",\"skip_offhours\"}, vals;banned={\"auto_reply\",\"autosend\",\"skip\",\"pending\",\"blocked\",\"limited\",\"off_hours\"};assert not (vals & banned), vals;print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 营业时间含跨午夜：06:00–24:00 全天真，22:00–02:00 在 23:30 真 / 03:00 假
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "business_hours" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 拟人延迟随机落 [1.0, 5.0] 秒区间（多次采样）
  Test: manual:bash -c 'python3 -c "import sys;sys.path.insert(0,\"services/agent/wechat-rpa\");import auto_reply as m;ds=[m.pick_reply_delay() for _ in range(50)];assert all(1.0<=d<=5.0 for d in ds),ds;assert len(set(ds))>1, \"延迟必须随机非常量\";print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 去重幂等：同 (contact,text,window) 第二次判重为真
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "dedup" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] LLM 超时 >20s → 跳过不发占位（reply 缺省，不外发 FAIL_PLACEHOLDER）
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "llm_timeout" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] daily_limit：0=不限；2 且 count>=2 → pending_human
  Test: manual:bash -c 'python3 -c "import sys;sys.path.insert(0,\"services/agent/wechat-rpa\");import auto_reply as m;assert m.decide_reply_route(True,True,True,99,0)==\"auto\";assert m.decide_reply_route(True,True,True,2,2)==\"pending_human\";print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 开关跳变播报决策：OFF→ON online / ON→OFF offline / 关键人未配 skip
  Test: manual:bash -c 'python3 -c "import sys;sys.path.insert(0,\"services/agent/wechat-rpa\");import auto_reply as m;assert m.broadcast_action(False,True,\"ks\")[\"action\"]==\"online\";assert m.broadcast_action(True,False,\"ks\")[\"action\"]==\"offline\";assert m.broadcast_action(False,True,\"\")[\"action\"]==\"skip\";print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 失败/掉线告警决策：给关键人产出告警 payload（带原因）
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_auto_reply_route.py -q -k "alert" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 5 个自动代理配置键可 upsert 并读回一致（默认关）
  Test: manual:bash -c 'cd apps/api && npx vitest run ../../sprints/06220821-line04-cs-no-approval-auto-reply/tests/cs-auto-agent-config.test.ts'
  期望: exit 0

- [ ] [BEHAVIOR] DB CHECK 放开：approval_source 容 system + status 容 auto_sent/pending_human，非法 status 仍 23514 拒
  Test: manual:bash -c 'DB="${DB:-${DATABASE_URL:-postgresql://localhost/zenithjoy}}"; npx tsx apps/api/db/migrations/run-migration.ts >/dev/null 2>&1 || true; psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id,task_type,content,status,approval_source) VALUES (gen_random_uuid(),'"'"'private_chat'"'"','"'"'c'"'"','"'"'auto_sent'"'"','"'"'system'"'"')" >/dev/null && psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id,task_type,content,status,approval_source) VALUES (gen_random_uuid(),'"'"'private_chat'"'"','"'"'c'"'"','"'"'pending_human'"'"','"'"'system'"'"')" >/dev/null && (psql "$DB" -c "INSERT INTO zenithjoy.wechat_publish_task (agent_id,task_type,content,status,approval_source) VALUES (gen_random_uuid(),'"'"'private_chat'"'"','"'"'c'"'"','"'"'garbage'"'"','"'"'system'"'"')" 2>&1 | grep -q "violates check constraint") && echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：非法营业时间格式 / 缺关键人 不崩主链路
  Test: manual:bash -c 'python3 -c "import sys;sys.path.insert(0,\"services/agent/wechat-rpa\");import auto_reply as m;
try:
  r=m.within_business_hours(\"bad\",\"24:00\",None)
  assert r in (False,True)
except ValueError:
  pass
print(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 租户隔离：路由/记录读写按 (tenant_id, contact)，不串租户
  Test: manual:bash -c 'python3 -m pytest services/agent/wechat-rpa/tests/test_reply_routing_isolation.py -q && echo OK'
  期望: OK

## BEHAVIOR:接缝 条目（windows_wechat 真机，未真验标 logic-done-pending）

- [ ] [BEHAVIOR:接缝] xian-rog 真机：开关上/下线播报真送达关键人 + 名单内自动回真送达不抢焦点 + 名单外 pending_human 真可见 + 失败告警真送达
  Test: e2e-verify.ps1（evaluator 派发 gh workflow run e2e-wechat-rpa.yml 在 self-hosted wechat-capable 执行）
  期望: 脚本 exit 0；四类接缝真送达断言通过；未跑真机前标 logic-done-pending，不得标 done
