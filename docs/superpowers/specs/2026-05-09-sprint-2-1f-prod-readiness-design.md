# Sprint 2.1f — 真客户首次成功 Path 1 产品级容错 设计

**日期**：2026-05-09
**作者**：Research Subagent（代用户走 superpowers:brainstorming 流程）
**分支**：`cp-05091537-sprint-2-1f-prod-readiness`（基于 main `11454b8`）
**Walking Skeleton Path**：[Path 1 客户首次成功](https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29) — 推进 Step 2「装客户端 + Agent 自动连中台」从 thin (sprint 2.1e ship 但跑不通) → robust (任何全新客户机能 e2e)。

---

## 1. 背景

Sprint 2.1e 已 ship install pack 形态：dashboard 下载 → 解压 → 编辑 .env → 双击 start.bat → agent.exe 上线。CI 全绿、Lead 自验在 xian-pc 真机走通了 7 步。

**但今天下午同事真客户视角 e2e 暴露了 9 个产品 bug，让 SOP 在任何全新客户机上完全跑不通**：

1. mac 后端启动报 `LICENSE_HMAC_SECRET 必须在生产环境设置` → register endpoint 返 `REGISTER_FAILED`
2. 9 条历史 hex license 在新正则下都通不过校验
3. `LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z2-9]{8}$/` 太严，不接受 hex 字符（含 0/1）
4. 老 hot-fix migration 用 `md5() hex` 回填 license，应该用 base32
5. Sprint 2.1e ship 的 `start.bat` 含 BOM，Windows cmd 报 `'ent' / 'tlocal' / 'et' / '/d' 不是命令`
6. agent 优先读 `%APPDATA%/config.json` fallback 不到 .env，`start.bat` 的 `set ZENITHJOY_LICENSE` 注入无效
7. `/api/agent/install-pack/download` 返 302 nginx 静态 zip，**所有用户拿同一个 .env.template 占位**，没有真烧 user license
8. `start.bat` 直接 spawn agent，无 license 预检，license 错只能从 agent 日志反查
9. 没有客户卸载脚本，客户想清状态/重装无方法

**Sprint 2.1f 一次性修完这 9 件**，让 SOP 真普世到任何全新客户机：双击 start.bat → 自动预检 license → 启动成功 + agent 上线绿灯。

---

## 2. 目标

把 **Path 1 Step 2** 从 thin (sprint 2.1e ship 但跑不通) → **robust** (任何全新客户机能 e2e)。

具体可验收：
- 任意全新 Windows 客户机：dashboard 注册 → 自动建 free license → 下载 install pack → 解压 → 双击 → agent 上线绿灯（**不需要客户编辑 .env**，license 已在 server 端烧入）
- 任意历史 license（hex 或 base32 字符集，含 0/1）注册接口都接受
- 客户改错 .env license → start.bat 预检阶段拒绝并告知如何修复，不会出现"agent 沉默退出客户找不到原因"
- 客户能双击 uninstall.bat 清干净状态后从 dashboard 重新走完整流程

---

## 3. 9 件 fix 详细方案

### Fix 1: mac 后端加 LICENSE_HMAC_SECRET

| 项 | 值 |
|---|---|
| file path | `apps/api/.env`（mac 本地 only，**不入 git**）；同步到 1Password CS Vault 条目「ZenithJoy API Env」+ 双写 `~/.credentials/zenithjoy-api.env` (chmod 600) |
| 改动概述 | 生成 32 字符随机串作为 `LICENSE_HMAC_SECRET`，写入 mac 后端 .env，重启 fastify |
| 验收 criteria | (a) 后端启动 console 不再打印 `LICENSE_HMAC_SECRET 必须在生产环境设置` 警告；(b) `curl -X POST localhost:3001/api/auth/register` 不再返 `{ code: 'REGISTER_FAILED' }`，正常返 `{ ws_token: ... }` |

### Fix 2: 9 条历史 hex license 一次性 UPDATE

| 项 | 值 |
|---|---|
| file path | `apps/api/db/migrations/20260509_120000_normalize_hex_licenses_to_base32.sql` |
| 改动概述 | UPDATE 含 `0`/`1` 字符的旧 hex license 到 base32 字符集；Fix 3 改正则后只含 hex 字母 (B-F + 2-9) 的可能不需 UPDATE，但**保险起见全部 9 条都过 normalize**，避免漏。`ZJ-TUSMOKE-*` 前缀豁免不动 |
| 验收 criteria | migration 执行后 `SELECT count(*) FROM zenithjoy.licenses WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$' AND license_key NOT LIKE 'ZJ-TUSMOKE-%'` = 0 |
| 受影响 license 清单 | ZJ-TUSMOKE-A0000001, ZJ-TUSMOKE-B0000001, ZJ-F-BA6C851E, ZJ-F-AA724212, ZJ-F-B2D0AEE8, ZJ-F-K3MYP4VR, ZJ-F-640DDB65, ZJ-F-48022F1C, ZJ-F-87E07BC8 |

### Fix 3: register 端正则放宽

| 项 | 值 |
|---|---|
| file path | `apps/api/src/services/license.service.ts` 第 95 行 |
| 改动概述 | 把 `LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z2-9]{8}$/` 改为 `/^ZJ-[FBMSE]-[A-Z0-9]{8}$/`，兼容 hex 历史 license（base32 是 `generateLicenseKey` 用的字符集，**校验时不该用同样严的字符集**） |
| 验收 criteria | vitest unit test：`isValidLicenseKeyFormat('ZJ-F-44D00A51') === true`、`isValidLicenseKeyFormat('ZJ-F-AAAAAAAA') === true`、`isValidLicenseKeyFormat('ZJ-F-K3MYP4VR') === true`；非法形式 `isValidLicenseKeyFormat('ZJ-F-AAAA') === false` |

### Fix 4: migration 回填 SQL 改用 base32

| 项 | 值 |
|---|---|
| file path | `apps/api/db/migrations/20260509_120100_helper_gen_base32_chars.sql`（新文件，与 Fix 2 同 sprint 但分两个 migration） |
| 改动概述 | 新增 PG function `zenithjoy.gen_base32_chars(n int) returns text`，下次任何 license 回填都用它而不是 `md5()`；**老 migration**（`20260507_180000_licenses_tier_check_add_free.sql` 第 25-38 行）**不重跑**，只新写 helper 入 git |
| 验收 criteria | migration 执行后 `SELECT length(zenithjoy.gen_base32_chars(8))` = 8；`SELECT zenithjoy.gen_base32_chars(8) ~ '^[A-Z2-9]{8}$'` = true（重复 100 次都返 true，证明字符集只在 [A-Z2-9]） |

### Fix 5: start.bat 编码 BOM 修

| 项 | 值 |
|---|---|
| file path | `services/agent/install-pack/start.bat`；新增 `services/agent/install-pack/.gitattributes`（`*.bat text eol=crlf`，但本 sprint 用 LF + chcp 测试） |
| 改动概述 | 用 ASCII only 重写 + 第一行加 `chcp 65001 >nul`（设 UTF-8）+ 行尾用 LF；用 `git add` 时 verify hexdump 第一字节不是 `EF BB BF` |
| 验收 criteria | (a) `hexdump -C services/agent/install-pack/start.bat \| head -1` 第一字节**不是** `ef bb bf`；(b) Windows cmd 真跑 `.\start.bat` 不再报 `'ent' / 'tlocal' / 'et' / '/d' 不是命令` |

### Fix 6: agent 优先读 .env，fallback 才读 %APPDATA%/config.json

| 项 | 值 |
|---|---|
| file path | `services/agent/src/index.ts`（重构 `loadOrInitConfig`） |
| 改动概述 | 新增 `loadConfigFromEnv()`：读 `process.env.ZENITHJOY_LICENSE` + `ZENITHJOY_API_BASE` + `ZENITHJOY_CHROME_DEBUG_PORT` → 拼成 `AgentConfig` 返回；`loadOrInitConfig()` 改为：先 `loadConfigFromEnv()` → 命中返；没设 fallback 走原 `readConfig()`（`%APPDATA%/config.json`）；都没有 → CLI `--license=` → 都没有 → 新建 |
| 验收 criteria | unit test：mock `process.env.ZENITHJOY_LICENSE = 'ZJ-F-XXXXXXXX'` 启动 → `loadOrInitConfig()` 返 `{ licenseKey: 'ZJ-F-XXXXXXXX' }`，**不读 config.json 文件**（验证 `fs.readFileSync(CONFIG_FILE)` 未被调用） |

### Fix 7: install pack download endpoint 真烧 user license 进 .env

| 项 | 值 |
|---|---|
| file path | `apps/api/src/routes/agent-install-pack.ts`（重写 `/download` handler） |
| 改动概述 | 改 GET `/download` 为 server-side handler：(1) 取 `req.user`（用现有 better-auth middleware），未登录 → 401；(2) 查该 user 的 active license，没 license → 503 `{ code: 'NO_ACTIVE_LICENSE' }`；(3) 拷贝静态 zip 到 `os.tmpdir()/install-pack-${user.id}/`；(4) 在临时目录里 `sed`/`replace` `.env`/.env.template 内 `ZENITHJOY_LICENSE=__PLACEHOLDER__` 为真 user license；(5) 重打包成 tar.gz；(6) `res.download()` stream 回客户端，传完后清临时目录 |
| 验收 criteria | (a) integration test：起 fastify + supertest，mock 登录 user A，user A 名下有 license `ZJ-F-AAAA1111` → GET `/download` → 200，stream 回 tar.gz；解压后 `cat .env` 含 `ZENITHJOY_LICENSE=ZJ-F-AAAA1111`；(b) 同样测试 user B 名下 `ZJ-F-BBBB2222` → 解压 .env 含 user B 的 license，**不同 user 拿到不同 .env**；(c) 未登录 → 401；(d) 登录但无 license → 503 |

### Fix 8: start.bat 启动前预检 license

| 项 | 值 |
|---|---|
| file path | `services/agent/install-pack/start.bat`（在 spawn agent.exe 前加预检段） |
| 改动概述 | 在 `set` 完 .env 变量后、spawn agent.exe 前，用 `curl -s -o nul -w "%%{http_code}" -X POST "%ZENITHJOY_API_BASE%/api/agent/heartbeat" -H "Content-Type: application/json" -d "{\"licenseKey\":\"%ZENITHJOY_LICENSE%\",\"machineId\":\"precheck\"}"` 拿 status code；200 → 启动 agent.exe；401/403 → echo "license 不对，回 dashboard 复制最新 license 改 .env" → pause + exit；503/超时 → echo "中台暂时不可用，5 分钟后重试" → pause + exit |
| 验收 criteria | 手动改 .env 里 license 为 `ZJ-F-WRONGAAA` → 双击 start.bat → 控制台打印「license 不对…」+ pause（**不 spawn agent.exe**，验证：另开 cmd `tasklist \| findstr zenithjoy-agent.exe` 无进程） |

### Fix 9: 客户卸载脚本

| 项 | 值 |
|---|---|
| file path | `services/agent/install-pack/uninstall.bat` |
| 改动概述 | (1) `taskkill /F /IM zenithjoy-agent.exe` 杀进程；(2) `rd /s /q "%APPDATA%\zenithjoy-agent"` 删配置；(3) `schtasks /delete /tn ZenithJoyAgent /f 2>nul` 删任务（如果有）；(4) self-delete trick：用 PowerShell `Start-Process powershell -ArgumentList '-Command', "Start-Sleep -Seconds 1; Remove-Item -Recurse -Force '$AGENT_DIR'" -WindowStyle Hidden`，让 PS 子进程在 .bat 退出 1 秒后删自己整个目录 |
| 验收 criteria | (a) 双击 uninstall.bat 后 `dir %APPDATA%\zenithjoy-agent` 报「找不到」；(b) `tasklist \| findstr zenithjoy-agent.exe` 无进程；(c) `dir %USERPROFILE%\Desktop\zenithjoy-agent` 报「找不到」（含 self-delete 验证） |

---

## 4. 测试策略（4 档 Cecelia 测试金字塔，照搬 PRD）

### 4.1 E2E（同事电脑真新机，不进 CI 由 Lead 真机自验）

完全卸载 → dashboard 重下载 install pack → 解压 → 双击 start.bat → agent online 显示绿灯 → 选 1 个抖音视频真发 → dashboard tasks 表行 + agent log 行做证据。

**Lead 自验机**：xian-rog（Windows，sprint 2.1e 已用过；本 sprint 用 `uninstall.bat` 清干净后再走全套）。证据 = 录屏 + 截图存 PR 描述。

### 4.2 Integration（vitest + supertest 进 CI）

- `apps/api/src/routes/__tests__/agent-install-pack.test.ts` 增加用例：
  - mock 登录 user A（持 license ZJ-F-AAAA1111） → GET `/download` → 200 + tar.gz body；解压后 `.env` 内 `ZENITHJOY_LICENSE=ZJ-F-AAAA1111`（**Fix 7**）
  - mock 登录 user B（持 license ZJ-F-BBBB2222） → 解压 .env 含 B 的 license（**不同 user 不同 .env**）
  - 未登录 → 401；登录但无 license → 503 `NO_ACTIVE_LICENSE`
- `apps/api/src/routes/__tests__/auth-register.test.ts`（如已存在则补 case，否则新建）：
  - register 接受 hex license `ZJ-F-44D00A51`（**Fix 3**）
  - register 接受 base32 license `ZJ-F-K3MYP4VR`（**Fix 3**）
- `apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts`（新建，跑 docker postgres）：
  - 准备 9 条 hex license fixture → run migration → 0 条违反新正则（**Fix 2**）
  - `gen_base32_chars(8)` 返 8 字符 [A-Z2-9]（**Fix 4**）

### 4.3 Unit（vitest 进 CI）

- `apps/api/src/services/__tests__/license.service.test.ts` 增加用例（**Fix 3**）：
  - `isValidLicenseKeyFormat('ZJ-F-44D00A51') === true`
  - `isValidLicenseKeyFormat('ZJ-F-K3MYP4VR') === true`
  - `isValidLicenseKeyFormat('ZJ-F-AAAA') === false`（长度不足）
  - `isValidLicenseKeyFormat('zj-f-aaaaaaaa') === false`（小写）
- `services/agent/src/__tests__/load-config.test.ts`（**Fix 6**）：
  - 设 `process.env.ZENITHJOY_LICENSE = 'ZJ-F-XXXXXXXX'` → `loadOrInitConfig()` 返此 license，验证 `fs.readFileSync` 未被调用 config.json
  - 不设 env、`%APPDATA%/config.json` 存在 → 走 fallback 读 config.json
  - 都不设 → 新建 fresh config

### 4.4 Trivial（手动验 + lint，不写自动化测试）

- start.bat 编码：`hexdump -C services/agent/install-pack/start.bat | head -1` 验证不是 BOM（**Fix 5**）
- 在 Windows cmd 真跑 .bat 不报 `'ent' 不是命令`（**Fix 5**） — Lead 自验
- uninstall.bat 真跑后清干净（**Fix 9**） — Lead 自验

---

## 5. 关键决策已做（4 条决策记录在案）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | LICENSE_HMAC_SECRET 怎么管？ | **存 1Password CS Vault + 双写 ~/.credentials/zenithjoy-api.env** | 全局 credentials 工作流强制：1Password 是唯一 SSOT，本地 .env 是 chmod 600 mirror，**绝不入 git** |
| 2 | 9 条历史 license 含 4 条真客户怎么处理？ | **直接 UPDATE，免费用户重启 agent 即可** | 免费用户改了 license 重启 agent 几秒重连，对客户体验影响极小；不 UPDATE 反而让客户卡在 register 失败 |
| 3 | install pack v1.0.1 是否覆盖 v1.0.0？ | **是，强制升级** | v1.0.0 装的客户 100% 跑不通（含 BOM start.bat + .env 占位 license），不强制升级等于让他们继续踩坑 |
| 4 | 同事电脑卸载前是否保留状态？ | **否，验证流程必须 fresh** | sprint 目标就是「任何全新客户机能 e2e」，留旧状态等于自欺欺人 |

---

## 6. Walking Skeleton 4 问 + 答案

| # | 问 | 答 |
|---|---|---|
| 1 | 本 sprint 推进哪条 Journey？ | **Path 1 客户首次成功**，Notion: 358c40c2ba6381b2a6eacd288cf82f29，当前 Maturity: not_started |
| 2 | 涉及几个角色？ | **1 个角色**（客户）。CI build artifact / mac 后端运维 = 辅助 |
| 3 | 推进哪些 Feature？ | Path 1 Step 2「装客户端 + Agent 自动连中台」从 **thin (sprint 2.1e ship 但跑不通) → robust (任何全新客户机能 e2e)** |
| 4 | Feature 0 端到端 smoke = 什么？ | `golden-path-1-smoke.sh` 跑到 **Step 2 ✅** 含三项新断言：(a) register 接受 hex license；(b) `/install-pack/download` 返 .env 含真 user license；(c) start.bat 无 BOM。FAIL = 整 sprint FAIL |

---

## 7. Out of Scope（明确不做）

1. **agent.exe auto-update / 增量包** — Sprint 3+
2. **多客户同时改一条 license 并发** — sprint 2.1g
3. **chrome :19222 user-data-dir 自动化生成** — sprint 2.1g（当前手动指定 `--user-data-dir=%USERPROFILE%\.zj-chrome` 够用）
4. **agent 健康监控 / metrics 上报** — sprint 2.1g
5. **install pack 体积优化 / 增量包** — sprint 2.1g（当前 ~60MB，全量下载）
6. **Authenticode 签名 / 公证** — sprint 3+（当前 SmartScreen 拦截需客户右键解除锁定）

---

## 8. 加厚铁律 4 实施顺序（RED → 减肥 → 增肌）

> 严格 commit-1 RED test → commit-2 减肥（删旧资产）→ commit-3 增肌（新实现）。CI `lint-tdd-commit-order` 强校。

### Commit 1：RED tests

文件：
- `apps/api/src/services/__tests__/license.service.test.ts`（新增 Fix 3 case，必 FAIL — 旧正则不接受 hex）
- `apps/api/src/routes/__tests__/agent-install-pack.test.ts`（新增 Fix 7 case，必 FAIL — 当前是 302 静态 redirect）
- `apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts`（必 FAIL — migration 还不存在）
- `services/agent/src/__tests__/load-config.test.ts`（必 FAIL — 当前优先读 config.json）
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` Step 2 加 hex license register + download .env 校验断言（必 FAIL）

`git commit -m "test(2.1f): RED tests for 9 件 fix（fix 2/3/4/6/7 自动化测试 + smoke step 2）"`

### Commit 2：减肥（删旧资产）

删除 / 改写：
- 重写 `services/agent/install-pack/start.bat`（旧的含 BOM + 无 license 预检）
- 重写 `apps/api/src/routes/agent-install-pack.ts` 的 `/download` handler（旧的 302 静态分发）
- 重写 `services/agent/src/index.ts` 的 `loadOrInitConfig`（旧的优先 config.json）

`git commit -m "refactor(2.1f): 减肥 — 删旧 BOM start.bat / 静态 download / config.json 优先逻辑"`

### Commit 3：增肌（新实现）

新增 / 修改：
- `apps/api/db/migrations/20260509_120000_normalize_hex_licenses_to_base32.sql`
- `apps/api/db/migrations/20260509_120100_helper_gen_base32_chars.sql`
- `apps/api/src/services/license.service.ts`（正则 [A-Z2-9] → [A-Z0-9]）
- `apps/api/src/routes/agent-install-pack.ts`（server-side .env 烧 license + stream tar.gz）
- `services/agent/src/index.ts`（envOrConfig：env 优先 fallback config.json）
- `services/agent/install-pack/start.bat`（ASCII + chcp 65001 + license 预检）
- `services/agent/install-pack/uninstall.bat`（新文件）
- `services/agent/install-pack/.gitattributes`（确保 .bat 不带 BOM）
- `apps/api/.env`（mac 本地，加 LICENSE_HMAC_SECRET，**不入 git**；同步 1Password CS Vault）

跑全套测试，所有 RED test 转 GREEN。

`git commit -m "feat(2.1f): 9 件 fix 让 Path 1 Step 2 真普世到任何全新客户机"`

---

## 9. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Fix 7 server-side .env 烧 license 的临时目录清理失败累积磁盘 | 低 | 长期掉盘 | `res.download()` 完成回调里 `fs.rmSync(tmp, {recursive:true})`；超时清理 cron（本 sprint 不做，加监控） |
| Fix 2 migration UPDATE 影响 4 条真客户活跃 agent | 中 | 客户 agent 离线几分钟 | migration 跑后**主动通知 4 个客户重启 agent**（运维任务，非 CI 自动）；新 license 写回 dashboard 客户复制 |
| Fix 8 license 预检接口 `/api/agent/heartbeat` 返 timeout 让 start.bat 卡死 | 中 | 客户双击后控制台无响应 | curl 加 `-m 10` 10 秒超时；超时归 503 路径告知"中台不可用" |
| Fix 9 self-delete trick 在某些 Windows 安全软件下被拦截 | 中 | 客户桌面残留 zenithjoy-agent 目录 | uninstall.bat 末尾给客户提示「如果目录还在，请手动右键删除」+ README 说明 |
| Fix 5 chcp 65001 在某些中文 Windows 上反而出乱码 | 低 | 客户看到？？？文字 | start.bat 内**完全 ASCII 文案**（不写中文），chcp 只为 .env 路径含中文目录时提供保险 |
| Fix 1 mac 后端 .env 同步 1Password 失败 | 低 | 服务器重启后 secret 丢 | 走 credentials skill 强制双写校验；commit 时 lead 主动 verify 1Password 有该条目 |

**回滚预案**：
- migration（Fix 2/4）一旦上线**不回滚**（DB UPDATE 不可逆，客户需重新换 license）；如发现严重问题 → 立即新 migration 把 UPDATE 反向写回 hex
- Fix 7 改 `/download` handler 失败 → revert 该 commit，客户回退到 sprint 2.1e 的 302 静态分发（虽然 .env 占位需手填，但至少能下载）
- Fix 5/8 start.bat 改坏 → revert 单 commit 即可，客户重下 install pack v1.0.0 临时用

---

## 10. DoD（Sprint 验收清单）

- [ ] CI `lint-tdd-commit-order` 通过（commit 顺序对：RED → 减肥 → 增肌）
- [ ] CI `lint-feature-has-smoke` 通过（golden-path-1 smoke step 2 真改）
- [ ] vitest `license.service.test.ts` Fix 3 case 全 GREEN
- [ ] vitest `agent-install-pack.test.ts` Fix 7 case 全 GREEN（含不同 user 不同 .env）
- [ ] vitest `load-config.test.ts` Fix 6 case 全 GREEN
- [ ] migration test `normalize-hex-licenses.test.ts` GREEN（0 条违反新正则）
- [ ] xian-rog Lead 真机自验：uninstall.bat 清干净 → dashboard 重下 → 双击 start.bat → agent 绿灯 → dryrun 发布 1 条
- [ ] PR 描述含 4 张截图（dashboard download 真 license / 解压 .env 内容 / agent 绿灯 / 发布回执）
- [ ] PR 描述声明：「本 PR 把 Path 1 Step 2 从 thin (sprint 2.1e ship 但跑不通) 推到 robust (任何全新客户机能 e2e)」并贴 Notion Path 链接
- [ ] LICENSE_HMAC_SECRET 已存 1Password CS Vault 「ZenithJoy API Env」+ 双写 `~/.credentials/zenithjoy-api.env` chmod 600

---

## 11. 参考 Sprint 2.1d/2.1e ship 的资产

- **Sprint 2.1e ship 的（本 sprint 改写）**：
  - `services/agent/install-pack/start.bat`（含 BOM bug — Fix 5 修）
  - `services/agent/install-pack/.env.template`（保留作为 .env 模板基础）
  - `services/agent/install-pack/README-1分钟跑通.txt`（更新提示「不需要编辑 .env」）
  - `services/agent/scripts/build-install-pack.sh`（保留 build 流程不变）
  - `apps/api/src/routes/agent-install-pack.ts`（`/download` handler 重写 — Fix 7）
  - `apps/api/src/services/install-pack-manifest.ts`（保留 manifest 读取）
- **Sprint 2.1d ship 的（本 sprint 不改）**：
  - `services/agent/supervisor/agent-supervisor.ps1`（agent 死循环防护，独立机制）
  - `services/agent/src/handlers/health-server.ts`（健康端点，独立机制）
- **Sprint 2.1a ship 的（本 sprint 不改）**：
  - Agent transport `type` 路由层修复
- **历史 hex license 9 条受影响清单**：见 §3 Fix 2
