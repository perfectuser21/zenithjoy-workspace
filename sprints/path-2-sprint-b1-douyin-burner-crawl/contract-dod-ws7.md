---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 7: Lead 客户机自验脚本 + 真证据归档

**范围**: scripts/lead-acceptance/path2-sprint-b1-self-test.cjs（mac → scp → rog 跑）+ .agent-knowledge/path-2/lead-acceptance-sprint-b1.md（PASS YAML + 截图证据）
**大小**: M
**依赖**: 全部完成 + 已 deploy

## ARTIFACT 条目

- [ ] [ARTIFACT] self-test 脚本存在
  Test: `bash -c "[ -f scripts/lead-acceptance/path2-sprint-b1-self-test.cjs ]"`

- [ ] [ARTIFACT] self-test 脚本含 channel msedge + headless true + user-data-dir
  Test: `node -e "const c=require('fs').readFileSync('scripts/lead-acceptance/path2-sprint-b1-self-test.cjs','utf8');[\"channel: 'msedge'\",'headless: true','launchPersistentContext','user-data-dir','C:\\\\\\\\Temp'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] self-test 脚本含 6 步流程（注册 / 飞书 0-touch 绑 / 写对标视频 URL / 触发 burner 绑定 / 等扫码截图 scp / crawl + 真飞书 GET 5 行验证）
  Test: `node -e "const c=require('fs').readFileSync('scripts/lead-acceptance/path2-sprint-b1-self-test.cjs','utf8');['signup','feishu/bind','target_videos','qr-bind','crawl-comments','feishu_lead_table_5_rows'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] self-test 脚本 waitForURL timeout >= 600000 (10 分钟，给 user 找手机)
  Test: `node -e "const c=require('fs').readFileSync('scripts/lead-acceptance/path2-sprint-b1-self-test.cjs','utf8');const m=c.match(/waitForURL[^)]*timeout:\s*(\d+)/);if(!m||parseInt(m[1])<600000)process.exit(1)"`

- [ ] [ARTIFACT] self-test 截图二维码 + scp 回 mac + console 显式提示 'user 现在扫'
  Test: `node -e "const c=require('fs').readFileSync('scripts/lead-acceptance/path2-sprint-b1-self-test.cjs','utf8');['screenshot','burner-qr','user 现在扫'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] self-test 真飞书 Bitable API GET 客户 Lead 表验证 5 行（不是 mock）
  Test: `node -e "const c=require('fs').readFileSync('scripts/lead-acceptance/path2-sprint-b1-self-test.cjs','utf8');if(!c.includes('open.feishu.cn')||!/items[\s\S]{0,200}length[\s\S]{0,200}5/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] lead-acceptance-sprint-b1.md 真证据文档存在 + size > 1KB + lead_acceptance_status: PASS
  Test: `bash -c "[ -f .agent-knowledge/path-2/lead-acceptance-sprint-b1.md ] && [ $(wc -c < .agent-knowledge/path-2/lead-acceptance-sprint-b1.md) -gt 1024 ] && grep -q 'lead_acceptance_status: PASS' .agent-knowledge/path-2/lead-acceptance-sprint-b1.md"`

- [ ] [ARTIFACT] lead-acceptance 文档含 6 步真证据 + xian-rog 标识 + user_intervention_count: 1
  Test: `node -e "const c=require('fs').readFileSync('.agent-knowledge/path-2/lead-acceptance-sprint-b1.md','utf8');for(let i=1;i<=6;i++){if(!c.includes('Step '+i))process.exit(1)}['xian-rog','user_intervention_count: 1','elapsed_seconds'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

## BEHAVIOR 索引（实际测试在 tests/ws7/）

见 `tests/ws7/lead-self-test-script-structure.test.ts`：
- self-test 脚本含 channel msedge + headless: true
- self-test 含 waitForURL timeout >= 10 分钟
- self-test 真飞书 GET 验证 5 行（含 commenter_id 非空 + comment text 非空）
- self-test 截图 6 张 + summary JSON 输出
