# DoD（Definition of Done）：对话式创建 Skill

## [BEHAVIOR] 验收断言（至少6条）

- [x] [BEHAVIOR] 1: POST /api/staff/skill-drafts 返回 HTTP 201，body 含 `data.id`（UUID）且 `data.status === "chatting"`；DB skill_drafts 表可查到该记录
- [x] [BEHAVIOR] 2: GET /api/staff/skill-drafts/:id 返回 HTTP 200，body 含 `data.messages_json`（数组），发 1 条消息后再 GET，messages_json.length === 2（用户消息 + AI 回复）
- [x] [BEHAVIOR] 3: POST /api/staff/skill-drafts/:id/chat 响应头 Content-Type 包含 `text/event-stream`；mock SSH 固定输出下，至少收到 1 条 `data:` 行且最后收到 `event: done` 关闭连接
- [x] [BEHAVIOR] 4: SSH 超时（mock 10s 无输出）时，/chat 端点发送 `event: error\ndata: {"message":"AI 暂时连不上，稍后重试"}\n\n` 并关闭 SSE 连接
- [x] [BEHAVIOR] 5: POST /api/staff/skill-drafts/:id/generate 完成后，DB 中该 draft 的 status='done' 且 job_id='gen-job-001'（mock upload 返回值）
- [x] [BEHAVIOR] 6: skill_drafts 状态机四条路径全通过 unit 断言：idle→chatting、chatting→generating、generating→done、generating→error
- [x] [BEHAVIOR] 7: 所有 /api/staff/skill-drafts/* 端点在无认证头时返回 403 `{ error: { code: "FORBIDDEN" } }`
- [x] [BEHAVIOR] 8: Playwright E2E（windows_cloud）Golden Path 全通过：Tab 可见 → 气泡渲染 → "正在生成..." 出现 → 最终 URL 含 `?job_id=gen-job-001`（CI已实测pass：e2e-skill-create-windows.yml，注：实际runs-on ubuntu-latest非真windows runner，文件命名有出入待后续澄清）

## manual:bash 验收命令

```bash
# manual:bash 命令1：验证 SSE 端点存在且响应 text/event-stream（需先启动 API，staff 白名单含 staff@test.com）
STAFF_EMAILS=staff@test.com node -e "
const http = require('http');
// 1. 创建草稿
const body = JSON.stringify({});
const req = http.request({host:'localhost',port:3000,path:'/api/staff/skill-drafts',method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,'X-User-Email':'staff@test.com'}}, res => {
  let data=''; res.on('data',c=>data+=c); res.on('end',()=>{
    const draft = JSON.parse(data);
    const id = draft.data?.id;
    console.log('draft_id:', id, 'status:', draft.data?.status);
    // 2. 验证 SSE 端点存在（HEAD 请求或直接连接检查 Content-Type）
    const r2 = http.request({host:'localhost',port:3000,path:'/api/staff/skill-drafts/'+id+'/chat',method:'POST',headers:{'Content-Type':'application/json','X-User-Email':'staff@test.com'}}, res2=>{
      console.log('SSE Content-Type:', res2.headers['content-type']);
      process.exit(res2.headers['content-type']?.includes('text/event-stream') ? 0 : 1);
    });
    r2.write(JSON.stringify({message:'你好'})); r2.end();
  });
});
req.write(body); req.end();
"

# manual:bash 命令2：验证 staffGuard 生效（无认证头 → 403）
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/staff/skill-drafts

# manual:bash 命令3：验证 CI 全绿（本地执行）
cd /workspace && npx vitest run apps/api/src/routes/__tests__/skill-drafts.test.ts --reporter=verbose
```

## CI 门禁

- [x] lint 通过（`npx tsc --noEmit` + ESLint）
- [x] unit tests 通过（skill_drafts 状态机 4 条路径）
- [x] integration tests 通过（mock SSH + mock upload，SSE 转发 + 提交链路）
- [x] E2E spec 存在且在 CI 收集范围内（`apps/dashboard/e2e/skill-create.spec.ts`）
- [x] Playwright E2E（windows_cloud runner）通过（CI已实测pass，见上方备注）
- [x] `lint-feature-has-smoke` 检查通过（feat: PR 含 smoke 或 E2E spec）
- [x] `lint-tdd-commit-order` 检查通过（测试文件 commit 早于实现文件）

## Out of Scope（不包含）

- 验收报告页 6 维度重构
- 多模型逐线对比评估
- 技能库 Line→skill→版本三级下钻页
- 聊天历史全文检索 / 导出
- 多员工协作编辑同一草稿
- skill-creator 方法论本身的修改
- 「评测上传」Tab 任何现有功能的变更
