# Learning — 员工知识中枢 路① 第一刀：身份只来自会话 + 员工目录 fail-closed 启动闸

**Sprint**: 08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e
**Path**: line11 员工知识中枢 / knowledge_experience_qa #step1

## 问题

Staff Hub 既有鉴权（`staffGuard`）的唯一判据是前端自填的两个明文身份头，改一个头就换一个人。
知识中枢要承载**跨企业**的经验正文，判据可伪造 = 跨企业隔离与授权分级同时失效。
同时 `feishu-login` 实测只返回 user JSON，没有 Set-Cookie、没有 session 行，
也没有任何"这个员工属于哪家企业"的概念。

## 解法

四件事咬在一起：

1. **员工目录**（`apps/api/src/staff-directory.ts`）：归属只能来自 `STAFF_*__<ORG>` 分组显式声明
   + `STAFF_ORG_MAP` 映射到 tenants uuid，绝不按邮箱域名后缀推断。A30 四项一致性自检在
   **listen 之前**跑，任一项不成立就 `process.exit(1)`。
2. **会话**（`staff-session.ts`）：走 better-auth 自己的 `internalAdapter.createSession` 落真 session 行，
   cookie 值按 better-auth 签名口径拼（`token.HMAC(token, secret)`），于是
   `auth.api.getSession()` 能原样校验 —— 没有自造第二套认证。
3. **`knowledgeAuthGuard`**：只解析会话，源码里一个身份头名都没有；A27 静态守卫扫描它。
4. **录入/读端**：归属只取自会话，请求体里的 `org_id` 一律忽略；写前跑账本身份 preflight，
   不过就 503 拒写，不静默写进一张同名空表。

## 踩到的坑（都会让人白查半天）

### 1. `router.use(staffGuard)` 会吃掉挂在它后面的一切

`app.use('/api/staff', staffRouter)` 之后再挂知识路由，请求会先进 staffRouter 被身份头闸接管，
「身份只来自会话」当场作废。知识路由**必须**挂在 `staffRouter` 之前
（`app.use('/api/staff/knowledge', knowledgeRouter)`）。
连带的：知识路由末尾要有 `router.all('*')` 兜底，否则 `POST /knowledge/projection` 这种
未匹配的方法会掉进 staffGuard，回一个 403 而不是 404/405——「投影表有没有写端点」这个问题
会被鉴权噪音盖掉。

### 2. 扁平白名单不是员工全集，用它判登录会把非主企业员工全挡在门外

A30-1a 要求扁平名单**恰好等于**主企业那一组，所以企业B 的员工按定义永远不在扁平名单里。
登录判「是不是员工」必须用整本目录（扁平 ∪ 所有分组），否则多企业根本登不进来第二家。

### 3. 新增启动闸差点把存量部署整个打死

存量 staging/prod 只配了扁平白名单，一个分组声明都没有。第一版实现下：
A30-1a 因「主企业那一组是空集」直接报红 → **apps/api 起不来**，连既有 16 个端点一起躺下；
就算起来了，登录也会因无归属声明全体 403。
修法是 `isDirectoryConfigured()`：一个分组/映射都没声明 = 知识中枢未启用，
A30 跳过、登录保持既有行为一字不变。这不是"默认组织兜底"——没配目录时谁都拿不到 org、
知识端点没有会话可用，仍然是 fail-closed；**只有真声明了目录，四项自检和归属要求才全部生效**。

### 4. `psql -t -A` 会把 `INSERT 0 1` 一起吐给你

`ORGA_TENANT_ID=$(psql -t -A -c "INSERT ... RETURNING id")` 拿到的是
`"<uuid>\nINSERT 0 1"`，塞进 `STAFF_ORG_MAP` 后表现为 **A30-3 莫名报红**（uuid 查不到）。
必须加 `-q`。这个坑的症状离根因很远，值得记住。

### 5. bash 里 `$VAR` 紧跟全角标点会被当成变量名的一部分

`ok "... ORGB=$ORGB_TENANT_ID）"` → `ORGB_TENANT_ID）: unbound variable`。
中文日志里 `$VAR` 后面跟着 `）`/`，` 的地方一律写 `${VAR}`。

### 6. `vi.mock('axios')` 的单测里 `axios.interceptors` 是 undefined

假飞书上游在 app 加载时装 axios 请求拦截器，没做判空 → `app.ts` 一 import 就 TypeError，
把 staff / skill-drafts / douyin-auth 三批既有 suite 拖成"收集失败"。
凡是在模块顶层对第三方库做全局改装，都要考虑"这个库在单测里被 mock 成空壳"。

### 7. Node 与 PG 时区不一致会让 `created_at` 比较悄悄反向

`public.learnings.created_at` 是 `timestamp without time zone`。测试用同一连接
`SELECT now()` 拿 JS Date 再作为参数比 `created_at > $2`：驱动按 **Node 本地时区**序列化，
PG 按 `timestamp` 解析丢掉偏移，于是 Node=Asia/Shanghai、PG=America/Chicago 时两者差 13 小时，
刚插入的行会被判成"早于脚本启动"。CI 里 Node 与 PG 都是 UTC 所以不显形，**本地复现必须
`TZ=<PG 的时区>` 跑**，否则会误以为是落库失败去查根本不存在的 bug。

### 8. `zenithjoy.tenants.license_key` 是 NOT NULL 且**无默认值**

任何 `INSERT INTO zenithjoy.tenants (name, plan)` 都会撞 not-null。现网代码一直显式传
license_key，所以只有新写的测试/fixture 会踩。本刀补了 `SET DEFAULT encode(gen_random_bytes(16),'hex')`，
不影响任何既有写入路径（显式传值时 DEFAULT 不参与）。

## 判据（下次怎么快速确认这层没坏）

```bash
bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh            # 全量
bash .github/workflows/scripts/smoke/knowledge-hub-path1-smoke.sh --a27-only # 只验静态守卫
```

A30 四条变异各起一次真进程、必须 exit≠0 且日志点名违规项；A27 往
`knowledge-auth.ts` 追加一行读头必须报红。**只断言"服务起来了"是假绿**——
自检没实现时服务照样起，所以正向断言必须配上"启动日志里有 `A30 staff-directory selfcheck passed`
和四个检查项名"。
