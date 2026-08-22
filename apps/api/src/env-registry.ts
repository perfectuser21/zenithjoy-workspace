/**
 * env 接缝通用闸门 —— 全 src 扫描 + 强制分类的 SSOT。
 *
 * 治根（接续 PR #800）：#800 的完整性测试只对**手写声明的 2 个文件**(CRITICAL_ENV_USAGE)
 * 做断言，别处新增的 `process.env.X` 它看不到 → 仍会"漏 key"。本模块把闸门升级成
 * "扫遍全 apps/api/src、每个 env 读取都必须被归类"：
 *
 *   扫到的每个 env 变量名，必须落在 REQUIRED_ENV ∪ OPTIONAL_ENV ∪ FRAMEWORK_ENV 三者之一。
 *   有任何一个没归类 → env-gate.test.ts 红 → 合不进。
 *
 * 以后谁加任何 `process.env.NEW_KEY` 却不登记/分类 → CI 红。这就是机器闸门。
 *
 * 维护方式（CI 报"未分类的 env：X"时，开发者必须二选一）：
 *   1. 缺了核心功能会静默坏 → 加进 REQUIRED_ENV（会被 verifyStartupConfig 启动自检 + 大声报）；
 *      但启动自检的 REQUIRED_ENV 真值仍以 startup-check.ts 为准，本文件 re-export 它，避免双源。
 *   2. 会读但缺了不致命 → 加进 OPTIONAL_ENV，**必须写 reason**（强制想清楚"为什么可选"）。
 *   3. 框架/运行时通用变量（NODE_ENV/CI/PORT…） → 加进 FRAMEWORK_ENV 白名单。
 */

import { REQUIRED_ENV } from './startup-check';

export { REQUIRED_ENV };

/**
 * 会读但缺了不致命的 env（有默认兜底 / 功能性可选 / 测试钩子）。
 * 每个必须写 reason —— 强制开发者想清楚"为什么这个可选"。
 */
export const OPTIONAL_ENV: { name: string; reason: string }[] = [
  // —— 认证 / 安全（有兜底或 feature 级，非全平台静默坏）——
  { name: 'BETTER_AUTH_URL', reason: 'better-auth 站点 URL，缺则用请求 host 推导' },
  { name: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: '受信任跨域来源，缺则用内置默认白名单' },
  { name: 'LICENSE_HMAC_SECRET', reason: 'license 签名密钥，仅 license 功能用，缺则该功能降级' },
  { name: 'FEISHU_STATE_SECRET', reason: '飞书 OAuth state 签名，缺则用内置默认值（生产应覆盖）' },
  { name: 'ZENITHJOY_INTERNAL_TOKEN', reason: '内部接口/super-admin 鉴权 token，缺则相应内部接口拒绝访问' },
  { name: 'SMOKE_TOKEN', reason: 'smoke 测试用临时 token，仅冒烟链路读取' },
  { name: 'CRM_RECONCILE_DRYRUN', reason: 'CRM 采集对账干跑开关，缺则默认干跑（只日志不软删，最安全）；仅字面 false 进真删模式' },
  { name: 'COMMANDER_MODEL', reason: '视频判定存疑复核官(commander)的 ToAPIs 模型名，缺则默认 deepseek-v4-flash；仅覆盖模型时设' },
  { name: 'LOCATOR_ASSIST_MODEL', reason: 'AI on-call 定位求助(tree-llm 后端)模型名，缺则默认 deepseek-v4-flash；仅覆盖模型时设' },
  { name: 'UITARS_BASE_URL', reason: 'UI-TARS 视觉定位后端网关(插座)，缺则 vision 后端显式降级 vision_not_configured——树失明兜底场景才通电' },
  { name: 'UITARS_API_KEY', reason: 'UI-TARS 视觉定位后端凭据(插座)，缺则 vision 后端显式降级——与 UITARS_BASE_URL 配对' },
  { name: 'WORKBENCH_ROW_LIMIT', reason: '路③ 结构化工作台单表行数上限，缺则默认 5000（产品阈值）；CI/E2E 覆写成小值来证明上限闸真的在，真插 5000 行会把 job 预算烧光' },

  // —— LLM / AI 供应商（feature 级，缺则对应模型路径不可用）——
  { name: 'TOAPI_BASE_URL', reason: 'toapi 网关地址，缺则用默认 base url' },
  { name: 'TOAPIS_BASE_URL', reason: 'ToAPIs 网关地址（content-judgment），缺则用默认 https://toapis.com/v1（api. 子域 2026-07-14 实测挂起后切主域）' },
  { name: 'TOAPIS_API_KEY', reason: 'ToAPIs 代理 Gemini API key，缺则 content-judgment 跳过 Gemini 调用，标 pending（target_profile_desc 为空时不调用 API）' },
  { name: 'OPENROUTER_API_KEY', reason: 'OpenRouter 凭据，缺则不走 OpenRouter 路径' },
  { name: 'OPENROUTER_BASE_URL', reason: 'OpenRouter 网关地址，缺则用默认' },
  { name: 'OPENROUTER_MODEL', reason: 'OpenRouter 模型名，缺则用默认模型' },
  { name: 'OPENAI_API_KEY', reason: 'OpenAI 凭据，缺则不走 OpenAI 路径' },
  { name: 'DASHSCOPE_API_KEY', reason: '阿里灵积凭据，缺则不走 dashscope 路径' },
  { name: 'PIAPI_API_KEY', reason: 'PiAPI 凭据，缺则对应能力不可用' },
  { name: 'OCR_RELAY_URL', reason: 'OCR 中继地址，缺则跳过 OCR 中继' },
  { name: 'ANDROID_APK_COS_URL', reason: '安卓 APK COS 直链，缺则用默认 COS 固定路径（CI assembleRelease 后 --force 覆盖上传该固定 path）' },

  // —— 微信客服（Path 4，可调参数 + 路径，均有默认）——
  { name: 'WECHAT_CS_MODEL', reason: '微信客服模型名，缺则用默认模型' },
  { name: 'WECHAT_CS_MAX_TOKENS', reason: '微信客服回复 max tokens，缺则用默认上限' },
  { name: 'WECHAT_PERSONA_PATH', reason: '微信客服人设文件路径，缺则用内置默认人设' },
  { name: 'WECHAT_BUSINESS_KB_PATH', reason: '微信客服业务知识库路径，缺则不挂知识库' },
  { name: 'WECHAT_SHORT_TERM_LIMIT', reason: '短期记忆条数上限，缺则用默认值' },
  { name: 'WECHAT_TENANT_SHORT_LIMIT', reason: '租户级短期记忆上限，缺则用默认值' },
  { name: 'WECHAT_CONSOLIDATE_THRESHOLD', reason: '记忆固化阈值，缺则用默认阈值' },
  { name: 'WECHAT_FEISHU_FACTS_SYNC', reason: '是否同步事实到飞书的开关，缺则默认不同步' },
  { name: 'WECHAT_FEISHU_FACTS_TABLE_ID', reason: '飞书事实表 ID，缺则跳过该同步' },

  // —— 飞书（Path 2/4，多租户 OAuth + Bitable，均 feature 级）——
  { name: 'FEISHU_API_BASE', reason: '飞书开放平台 base url，缺则用官方默认' },
  { name: 'FEISHU_APP_ID', reason: '飞书应用 ID，缺则飞书集成不可用' },
  { name: 'FEISHU_APP_SECRET', reason: '飞书应用密钥，缺则飞书集成不可用' },
  { name: 'FEISHU_TENANT_ID', reason: '飞书租户 ID，缺则用默认/请求推导' },
  { name: 'FEISHU_REDIRECT_URI', reason: '飞书 OAuth 回调地址，缺则用默认推导' },
  { name: 'FEISHU_ALERT_WEBHOOK', reason: '飞书告警 webhook，缺则不发告警' },
  { name: 'FEISHU_NOTIFY_WEBHOOK', reason: '飞书通知 webhook，缺则不发通知' },
  { name: 'FEISHU_COMPETITOR_APP_TOKEN', reason: '对标视频表 app token，缺则该表不可用' },
  { name: 'FEISHU_COMPETITOR_TABLE_ID', reason: '对标视频表 ID，缺则该表不可用' },
  // 去飞书（2026-06-30 / 2026-07-14 决策19e6480c）：Line04 私聊已不查飞书"客户档案"/不写"互动记录"，
  // 朋友圈 generateMomentDraft 已改读写本地表 zenithjoy.wechat_marketing_profile（PR#1289）；
  // Path2 的 lead-config.ts/feishu-customer-list.ts/FeishuBindTenant 已确认死代码删除（本PR）。
  // FEISHU_CUSTOMER_TABLE_ID / FEISHU_INTERACTION_TABLE_ID / FEISHU_PROFILE_TABLE_ID /
  // FEISHU_SCHEDULE_TABLE_ID / FEISHU_TABLE_ID_LEADS / FEISHU_PATH4_APP_TOKEN /
  // FEISHU_TEST_APP_TOKEN 不再被任何 src 读取，已下线。

  // —— 抖音 / 平台对接 ——
  { name: 'DOUYIN_CLIENT_KEY', reason: '抖音开放平台 client key，缺则抖音 OAuth 不可用' },
  { name: 'DOUYIN_CLIENT_SECRET', reason: '抖音开放平台 client secret，缺则抖音 OAuth 不可用' },

  // —— Notion ——
  { name: 'NOTION_INTEGRATION_TOKEN', reason: 'Notion 集成 token，缺则 Notion 同步不可用' },
  { name: 'NOTION_PARENT_PAGE_ID', reason: 'Notion 父页面 ID，缺则用默认/跳过' },

  // —— GitHub（secret 写入等）——
  { name: 'GH_TOKEN', reason: 'GitHub API 读取 token，缺则 staff-hub path health 走匿名请求，可能遇到 rate limit' },
  { name: 'GH_REPO_OWNER', reason: 'GitHub repo owner，缺则用默认' },
  { name: 'GH_REPO_NAME', reason: 'GitHub repo name，缺则用默认' },
  { name: 'GH_SECRETS_WRITE_PAT', reason: 'GitHub secrets 写入 PAT，缺则 secret 写入功能不可用' },
  { name: 'GITHUB_TOKEN', reason: 'GitHub API 读取 token 的 Actions 默认别名，缺则退回 GH_TOKEN 或匿名请求' },

  // —— Agent / 安装包分发 ——
  { name: 'ZENITHJOY_API_URL', reason: '中台对外 API url，缺则用默认/请求推导' },
  { name: 'AGENT_PUBLIC_WS_URL', reason: '本实例对外 agent WS 地址(wss://.../agent-ws)，下载时烧进 agent .env 的 ZENITHJOY_API_URL；缺则不烧(agent 用 start.bat 生产兜底)' },
  { name: 'AGENT_PUBLIC_BASE_URL', reason: '本实例对外 agent HTTPS 根地址，下载时烧进 agent .env 的 ZENITHJOY_API_BASE；缺则不烧' },
  { name: 'INSTALL_PACK_MANIFEST_PATH', reason: '安装包 manifest 路径，缺则用默认路径' },
  { name: 'INSTALL_PACK_STATIC_ROOT', reason: '安装包静态目录，缺则用默认目录' },
  { name: 'INSTALL_PACK_REMOTE_URL', reason: '安装包远程直链，缺则不走远程直链' },
  { name: 'INSTALL_PACK_FIXTURE_PATH', reason: '安装包测试 fixture 路径，仅测试链路用' },

  // —— 各种 base url / 地址（均有默认或请求推导）——
  { name: 'API_BASE', reason: 'API base url，缺则用请求推导' },
  { name: 'API_PUBLIC_URL', reason: '对外 API url，缺则用请求推导' },
  { name: 'PUBLIC_API_BASE', reason: '公开 API base，缺则用请求推导' },
  { name: 'DASHBOARD_URL', reason: 'Dashboard 地址，缺则用默认' },
  { name: 'DASHBOARD_BASE_URL', reason: 'Dashboard base url，缺则用默认' },
  { name: 'CECELIA_BRAIN_URL', reason: 'Cecelia Brain 地址，缺则不回写 Brain' },
  { name: 'LINE_HEALTH_STAGING_VERSION_URL', reason: '业务线健康看板查 staging apps/api 真实 /version 的内网地址，缺则默认走 Docker 容器名 zenithjoy-api-staging' },
  { name: 'LINE_HEALTH_PROD_VERSION_URL', reason: '业务线健康看板查 production apps/api 真实 /version 的内网地址，缺则默认走 Docker 容器名 zenithjoy-api-prod' },
  { name: 'CONTENT_SERVICE_PROXY_URL', reason: '内容服务代理地址，缺则直连' },
  { name: 'CONTENT_OUTPUT_DIR', reason: '内容产出目录，缺则用默认目录' },
  { name: 'SCREENSHOTS_DIR', reason: '截图输出目录，缺则用默认目录' },

  // —— 杂项可调参数 / 租户 ——
  { name: 'ADMIN_EMAILS', reason: '管理员邮箱白名单，缺则无人有管理员权限（feature 级）' },
  { name: 'ADMIN_FEISHU_OPENIDS', reason: '管理员飞书 openid 白名单，缺则该路径无管理员' },
  { name: 'SCHEDULER_TENANT_ID', reason: '调度器默认租户，缺则用默认/逐租户' },
  { name: 'N08_TIMEOUT_MS', reason: 'N08 任务超时毫秒，缺则用默认超时' },

  // —— 数据库连接（DATABASE_URL 与拆分式 DATABASE_HOST+DATABASE_NAME 二选一，启动自检按组校验）——
  // 注：db/connection.ts 实际用拆分式参数；DATABASE_URL 是另一种部署形态的连接串，二者满足其一即可。
  // 启动自检（startup-check.ts REQUIRED_ENV_GROUPS）按"二选一组"校验，不再硬列 DATABASE_URL 进 REQUIRED。
  { name: 'DATABASE_URL', reason: '数据库连接串（整串形态），与拆分式 DATABASE_HOST+DATABASE_NAME 二选一' },
  { name: 'DATABASE_HOST', reason: '数据库 host（拆分式连接），与 DATABASE_URL 二选一' },
  { name: 'DATABASE_PORT', reason: '数据库端口（拆分式连接），缺则用默认 5432' },
  { name: 'DATABASE_NAME', reason: '数据库名（拆分式连接），与 DATABASE_URL 二选一' },
  { name: 'DATABASE_USER', reason: '数据库用户（拆分式连接）' },
  { name: 'DATABASE_PASSWORD', reason: '数据库密码（拆分式连接）' },

  // —— Ability Acceptance 版本来源（Staff Hub 验收台，Line 00）——
  { name: 'STAGING_VERSION', reason: 'Staging 环境版本号，缺则回落读 VERSION 文件或返回 Unknown' },
  { name: 'PRODUCTION_VERSION', reason: 'Production 环境版本号，缺则回落读 VERSION 文件或返回 Unknown' },

  // —— 员工工具（Line 00 运营中枢，staff only）——
  { name: 'STAFF_EMAILS', reason: '员工邮箱白名单，逗号分隔，缺则 staffGuard 一律 403（无 dev 放行）' },
  { name: 'STAFF_FEISHU_OPENIDS', reason: '员工飞书 open_id 白名单，逗号分隔，STAFF_EMAILS 的兜底路径——部分飞书账号从不返回 email 字段，open_id 是必定返回的字段' },
  { name: 'CECELIA_SKILL_EVAL_URL', reason: 'Cecelia skill-eval 服务地址，缺则用默认 http://hk-vps:9100' },
  { name: 'STAFF_HUB_GITHUB_REPO', reason: 'Staff Hub 业务线健康页读取 smoke run 时使用的 GitHub 仓库，缺则回退默认 perfectuser21/zenithjoy-workspace' },
  { name: 'PRODUCT_MAP_PATH', reason: 'Staff Hub 业务线健康看板读取的 product-map.json 路径覆盖（测试/非常规部署布局用），缺则按 cwd 逐级向上找 product-map/generated/product-map.json' },
  { name: 'MMV_CLAUDE_ACCOUNT_DIR', reason: '对话式创建Skill在mmv上跑claude -p时用哪个账号池目录，缺则默认 /Users/administrator/.claude-account1' },
  { name: 'INTERNAL_API_BASE', reason: '内部回调服务基础 URL（detached 子进程通知终态），缺则默认 http://localhost:3001' },

  // —— Agent 离线告警（Sprint 07201705）——
  { name: 'AGENT_OFFLINE_THRESHOLD_HOURS', reason: 'Agent 离线告警阈值（小时），缺则默认 4 小时' },
  { name: 'AGENT_SCAN_INTERVAL_MS', reason: 'Agent 离线扫描间隔（毫秒），缺则默认 60000（1 分钟）' },

  // —— 测试 / 故障注入钩子（仅测试与冒烟读取，生产不设）——
  { name: 'TEST_MODE', reason: '测试模式开关，仅测试/冒烟读取' },
  { name: 'FORCE_TOAPI_FAIL', reason: '故障注入：强制 toapi 失败，仅测试用' },
  { name: 'OPENROUTER_FORCE_5XX', reason: '故障注入：强制 OpenRouter 5xx，仅测试用' },
];

/**
 * 框架 / 运行时通用变量白名单。这些由 Node / 运行时 / CI 注入，不需逐个业务分类。
 */
export const FRAMEWORK_ENV: string[] = [
  'NODE_ENV',
  'PORT',
  'CI',
  'TZ',
  'HOME',
  'PATH',
  'PWD',
  'TMPDIR',
  'VITEST',
  // npm_* 一族（npm/pnpm 注入），用前缀匹配，见 isFrameworkEnv
];

/**
 * 已分类的 env 名称集合（REQUIRED ∪ OPTIONAL.name ∪ FRAMEWORK）。
 */
export function classifiedEnvNames(
  lists: {
    required: string[];
    optional: { name: string }[];
    framework: string[];
  } = { required: REQUIRED_ENV, optional: OPTIONAL_ENV, framework: FRAMEWORK_ENV },
): Set<string> {
  const set = new Set<string>();
  for (const k of lists.required) set.add(k);
  for (const o of lists.optional) set.add(o.name);
  for (const k of lists.framework) set.add(k);
  return set;
}

/**
 * 框架变量判断：白名单命中，或 npm_ 前缀（npm/pnpm 注入的一大族变量）。
 */
export function isFrameworkEnv(name: string, framework: string[] = FRAMEWORK_ENV): boolean {
  if (framework.includes(name)) return true;
  if (name.startsWith('npm_')) return true;
  return false;
}

/**
 * 纯函数闸门核心（便于单测 proven-to-fire）：
 * 从一段源码文本里抓所有 `process.env.IDENTIFIER` / `process.env['STRING']` 读取，
 * 返回"未被任何清单归类"的 env 名（去重、排序）。
 *
 * 只抓真正的 process.env.X 读取形式。注意：本函数不解析注释/字符串字面量上下文，
 * 调用方（env-gate.test.ts）通过逐文件 readFileSync 真实源码喂入；正则只匹配
 * `process.env.` 紧跟合法标识符 / 带引号字符串键，已能避开绝大多数误报。
 */
export function findUnclassifiedEnv(
  srcText: string,
  lists: {
    required: string[];
    optional: { name: string }[];
    framework: string[];
  } = { required: REQUIRED_ENV, optional: OPTIONAL_ENV, framework: FRAMEWORK_ENV },
): string[] {
  const names = extractEnvNames(srcText);
  const classified = classifiedEnvNames(lists);
  const unclassified = new Set<string>();
  for (const name of names) {
    if (classified.has(name)) continue;
    if (isFrameworkEnv(name, lists.framework)) continue;
    unclassified.add(name);
  }
  return [...unclassified].sort();
}

/**
 * 从源码文本抽取所有被 process.env 读取的变量名（去重、排序）。
 * 匹配两种形式：
 *   process.env.IDENTIFIER
 *   process.env['STRING'] / process.env["STRING"]
 */
export function extractEnvNames(srcText: string): string[] {
  const names = new Set<string>();
  // 形式一：process.env.IDENTIFIER
  const dotRe = /process\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  // 形式二：process.env['KEY'] / process.env["KEY"]
  const bracketRe = /process\.env\[\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = dotRe.exec(srcText)) !== null) names.add(m[1]);
  while ((m = bracketRe.exec(srcText)) !== null) names.add(m[1]);
  return [...names].sort();
}
