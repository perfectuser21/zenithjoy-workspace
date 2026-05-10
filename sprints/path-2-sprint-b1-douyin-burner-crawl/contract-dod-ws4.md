---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: lead-writer service（复用 Sprint A multitenant Bitable）

**范围**: 新建 lead-writer.ts，调 multitenant writeRecord 写飞书 Lead 表
**大小**: M
**依赖**: 无（service 层独立）

## ARTIFACT 条目

- [ ] [ARTIFACT] lead-writer.ts 文件存在 + 导出 writeLeadsFromComments
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');if(!/export\s+(async\s+)?function\s+writeLeadsFromComments|export\s*{\s*writeLeadsFromComments/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] lead-writer 必须 import writeRecord from feishu-bitable-multitenant
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');if(!/from\s+['\"][\.\/]+feishu-bitable-multitenant['\"]/.test(c)||!/writeRecord/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] lead-writer 不得直接 axios 飞书域名（防绕过 service 重写）
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');if(/axios[\s\S]*open\.feishu\.cn|axios[\s\S]*open-apis\/bitable/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] lead-writer 字段映射含 5 个飞书表头
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');['评论者抖音 ID','评论内容','来源视频 URL','抓取时间','状态'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] lead-writer 含重试 2 次 + lead_write_status 标记
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/lead-writer.ts','utf8');['retry','lead_write_status'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/lead-writer.test.ts`：
- 5 条评论 → 5 次 writeRecord 调用
- 字段映射正确（评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态）
- 状态默认 '已抓取'
- 评论数 0 → 早 return + 不调 writeRecord
- writeRecord 抛错 → 重试 2 次后仍失败 → 返 lead_write_status='failed'
- writeRecord 第一次抛错第二次成功 → 完成 + 返 success
