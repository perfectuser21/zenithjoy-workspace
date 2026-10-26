# CRM 历史聊天手动补录

GP-Anchor: line04/passive_reception#step4

客户详情中的“补录聊天记录”支持粘贴文字或选择 UTF-8 TXT。用户核对个人/群、会话名称及来源后生成 AI 预览，可以修改建议，再明确确认保存。历史区域可回读原文、建议和依据。本次材料不代表完整微信历史。

目标必须是已加入 CRM 名册的真实客户，且指定其所属微信账号。写操作要求真实登录 session 的 owner/admin；同租户授权用户可读。材料里的来源账号、发言人或时间可以未知，不能据此绕过目标授权。群仅作为沟通渠道，不创建成员客户或合并同名身份。

## 存储与恢复

先应用 `apps/api/db/migrations/20261026_161900_crm_manual_history.sql`。三个独立表保存待确认预览、正式原文和请求回执，不写微信入站消息表，不触发自动回复或采集。正式材料按租户、目标账号、客户和完整材料摘要精确去重，保留首次提交者与结果。请求标识按提交人隔离，载荷改变拒绝复用。近似或重叠材料不会被静默删除。

默认单份 32 KiB，环境变量 `CRM_MANUAL_HISTORY_MAX_BYTES` 可以收窄上限；超限明确拒绝，不能静默截断。预览有效 15 分钟，模型请求超时 45 秒，无自动模型重试。同一用户并发整理被数据库锁限制。保存结果不明时页面先查询原请求回执，确认未保存后使用同一请求重试。导入时间与历史时间分开，缺失历史时间保持未知。

已验证登录用户每分钟最多 120 次补录接口请求，其中预览最多 20 次；超限返回明确的 429，不继续访问目标数据或调用模型。

原文和人工确认的建议同事务提交。模型建议中的证据必须逐字存在于原文；时间、发言人不能凭空补写。模型错误只记录脱敏原因，不记录原文、模型提示或输出。正式数据已进入后，回退应用代码时保留三个表，不能以回退为由删除历史。

## 验证

```bash
npm run test --workspace=apps/api -- src/services/crm/__tests__/manual-history.test.ts src/routes/__tests__/crm-manual-history.test.ts src/routes/__tests__/crm-manual-history-session.test.ts src/llm/__tests__/openrouter-sensitive-error.test.ts
npm run test --workspace=apps/dashboard -- src/components/__tests__/ManualChatImport.test.tsx src/pages/__tests__/CustomerProfilePage.test.tsx
SMOKE_ALLOW_WRITE=1 bash .github/workflows/scripts/smoke/crm-manual-history-smoke.sh
```

Smoke 默认不发请求、不写数据。显式授权后使用本机 `initdb`/`pg_ctl` 创建并销毁临时 PostgreSQL，运行真实 API 和 Chromium。模型和登录明确使用合成 fixture，不等于生产登录验证。需已安装 Chromium（`npx playwright install chromium`）。测试不读取现有客户资料，也不连接生产库。

显式设置 `CRM_MANUAL_REAL_AI=1` 并从凭据管理注入 `OPENROUTER_API_KEY` 时，只运行合成材料的一次真实模型调用及隔离数据库保存；不把密钥写入命令或仓库。该项已实测成功，真实生产登录、上线迁移及客户业务验证仍待发布验收。

原任务 `188e0d7d-74ac-4b75-b25a-a6edeb9092db` 因自动流水线不支持浏览器 QA 在 spec 阶段失败，尚无实现。有头任务 `80773065-7af0-4163-91c8-18b7ba4952fa` 接手实现与浏览器验证；没有降低原验收标准或关闭流水线门禁。
