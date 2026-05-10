---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: Dashboard `DouyinBurnerBindPage.tsx` + 路由

**范围**: 新建 dashboard 绑小号 + 抓评论一体化页面
**大小**: L
**依赖**: WS3

## ARTIFACT 条目

- [ ] [ARTIFACT] DouyinBurnerBindPage.tsx 文件存在
  Test: `bash -c "[ -f apps/dashboard/src/pages/DouyinBurnerBindPage.tsx ]"`

- [ ] [ARTIFACT] 页面含飞书未绑 disabled / account_label 输入 / sessions 列表 / video 下拉 / 开始抓取 / Bitable URL 跳转
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/DouyinBurnerBindPage.tsx','utf8');['请先完成飞书绑定','account_label','开始绑定','sessions','target_videos','开始抓取评论','feishu.cn/base'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] 页面校验 account_label !== 'default'（保留给 main）
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/DouyinBurnerBindPage.tsx','utf8');if(!/account_label[\s\S]{0,200}['\"]default['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] App.tsx 路由表挂 /dashboard/douyin-burner-bind
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('/dashboard/douyin-burner-bind')||!c.includes('DouyinBurnerBindPage'))process.exit(1)"`

- [ ] [ARTIFACT] Sprint A FeishuBindTenant.tsx + Path 1 DouyinBindPage.tsx 字节级未变
  Test: `bash -c "git diff origin/main...HEAD -- apps/dashboard/src/pages/FeishuBindTenant.tsx apps/dashboard/src/pages/DouyinBindPage.tsx | wc -l | grep -q '^0$'"`

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `tests/ws5/douyin-burner-bind-page.test.tsx`：
- 飞书未绑（GET status bound=false）→ 表单 disabled + 提示「请先完成飞书绑定」
- 飞书已绑 → 表单 enabled
- account_label='default' 输入 → 校验报错 + 提交按钮 disabled
- 提交合法 account_label → 调 POST /api/agent/burner/qr-bind + 显示「等扫码」状态
- GET /api/agent/burner/sessions → 渲染 burner 列表（含 account_label / 昵称 / 状态）
- video 下拉拉 fetchLeadConfig 的 target_videos
- 「开始抓取评论」需选 video + 至少 1 个 active burner，否则 disabled
- 抓取完成（status=done + comment_count=5）→ 显示「抓取完成 5 条 → 看飞书 Lead 表」+ Bitable URL 链接
- comment_count=0 → 显示「该视频暂无评论」
- lead_write_status=failed → 显示「重试」按钮
