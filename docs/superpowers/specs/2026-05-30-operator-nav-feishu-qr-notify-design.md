# Operator 导航 + 飞书 QR 推送 + 告警改飞书 设计文档

**Goal:** 三项改进：① 超管导航加 Operator 入口；② 扫码时截图推飞书卡片；③ session 失效告警改发飞书群

**Architecture:** 纯改动，不引入新服务。飞书图片上传用 Cecelia App 凭据（FEISHU_APP_ID/APP_SECRET），推送统一走 ZENITHJOY_FEISHU_WEBHOOK（悦升云端总群）。

**Tech Stack:** React/TypeScript（Dashboard）、Node.js CJS（agent publisher）、Playwright（截图）、Feishu Bot API

---

## 改动一：Operator 导航入口

**文件：** `apps/dashboard/src/contexts/InstanceContext.tsx`

在 `features` 对象中添加：
```typescript
'operator-dashboard': true,  // /operator Session 健康监控（superAdmin only）
```

该 feature flag 控制 `navigation.config.ts` 第 273 行已有的 Operator 导航项显示。`requireSuperAdmin: true` 确保只有超管可见。

---

## 改动二：QR 弹窗截图 → 飞书互动卡片

**文件：** `services/agent/publishers/qr-bind-operator.cjs`

**插入位置：** 第 115 行 `await new Promise(r => setTimeout(r, 3000))` 之后

**流程：**
1. `const qrScreenshot = await page.screenshot()` — 截 Buffer
2. 用 `FEISHU_APP_ID` + `FEISHU_APP_SECRET` POST `https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal` → 拿 `app_access_token`
3. POST `https://open.feishu.cn/open-apis/im/v1/images` with `image_type=message` + PNG buffer → 拿 `image_key`
4. POST `ZENITHJOY_FEISHU_WEBHOOK` 发互动卡片：
   - 标题：`🔑 {platform} 扫码绑定请求`
   - 图片：`image_key`
   - 文字：`请在 3 分钟内用手机扫描上方二维码`
5. 失败（任意步骤）→ `process.stderr.write` 记录，不抛异常，继续主流程

**所需环境变量（agent 进程）：**
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `ZENITHJOY_FEISHU_WEBHOOK`

---

## 改动三：Session 失效告警改发飞书群

**文件：** `scripts/sessions/verify-operator-douyin.js`

**变更：**
- 删除 `barkNotify` 函数（第 29-34 行）
- 将所有 `barkNotify(title, body)` 调用替换为调 `ZENITHJOY_FEISHU_WEBHOOK` 发文本消息
- 将 `FEISHU_BOT_WEBHOOK` 常量改名为 `ZENITHJOY_FEISHU_WEBHOOK`（使用 `process.env.ZENITHJOY_FEISHU_WEBHOOK`）
- `sendFeishuAlert` 函数逻辑不变，webhook URL 来源改为新变量

**GitHub Actions workflow** (`douyin-operator-session-e2e.yml`)：
- 新增 `ZENITHJOY_FEISHU_WEBHOOK: ${{ secrets.ZENITHJOY_FEISHU_WEBHOOK }}` 环境变量
- 移除 `BARK_URL` 环境变量

**GitHub Secret：** 需手动添加 `ZENITHJOY_FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/5a3d4500-95ec-43fb-a10d-89a350fe9eda`

---

## 测试策略

- **改动一：** trivial — 加一行 feature flag，肉眼验证导航出现
- **改动二：** trivial — 无单元测试，手动触发 QR 绑定确认飞书收到卡片
- **改动三：** trivial — 无单元测试，手动触发 workflow 或模拟失败确认飞书收到告警

---

## 验收标准

- [ ] 超管登录后左侧"管理员"分组可见"Session 健康监控"入口
- [ ] xian-pc 点"抖音登录"后，悦升云端总群收到带 QR 截图的飞书卡片
- [ ] 每日 CI session 验证失败时，悦升云端总群收到飞书文本告警
- [ ] CI 全绿
