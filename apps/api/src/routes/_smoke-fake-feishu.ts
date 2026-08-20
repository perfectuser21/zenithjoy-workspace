/**
 * DEV-only 假飞书上游（沿用本仓 _smoke-fake-llm / _smoke-fake-agent-burner 先例）
 *
 * 门禁：NODE_ENV === 'production' 一律 404，且只由 app.ts 在非生产条件挂载 —— 生产走真
 * open.feishu.cn，本模块的任何代码路径都到不了。
 *
 * 为什么需要它：真飞书授权 code 是一次性的、必须真人点授权页换来，CI 与 windows_cloud runner
 * 都拿不到；真 FEISHU_APP_SECRET 也不下发到 GHA。把上游顶掉，登录之后的全链路（会话签发、
 * 按声明组织入驻、知识端点鉴权）才能被真验。这一条被登记在合同「未覆盖真实链路清单」#1，
 * 补位方式是主理人在 staging 用真飞书账号真登录一次。
 *
 * 身份从**当前员工目录 env 反查**，不写死 open_id —— 不同测试套件声明的成员各不相同，
 * 写死就只有一套能用：
 *   code = "<任意前缀->code-<orgkey>"  → 该 <ORGKEY> 分组里的第一个成员
 *   code = "<任意前缀->code-noorg"     → 无归属账号（NOORG 分组，或扁平名单里没被任何分组声明的那个）
 *
 * 两种消费方式（同一份 canned 数据，行为完全一致）：
 *   1. HTTP —— 本 router 挂在 /api/_smoke/fake-feishu，smoke / E2E 把 FEISHU_API_BASE 指过来
 *   2. 进程内 —— installFakeFeishuAxiosShim() 装一个 axios 请求拦截器，把打向该 base 的请求
 *      就地作答。vitest 里 supertest 不监听真端口，没有这一层登录链路根本走不通；
 *      而 routes/staff.ts 保持纯 axios 调用、一个 if 都不加，判定逻辑不因测试而分叉。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import axios, { type InternalAxiosRequestConfig, type AxiosAdapter } from 'axios';
import { parseOrgGroups, parseFlatDirectory } from '../staff-directory';

const router = Router();

interface FakeIdentity {
  open_id: string;
  name: string;
  email: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 分组里第一个"看起来像 open_id"的成员（邮箱走 email 字段，不当 open_id 用） */
function pickGroupMembers(orgKey: string): FakeIdentity | null {
  const groups = parseOrgGroups(process.env);
  const members = groups.get(orgKey.toUpperCase());
  if (!members || members.size === 0) return null;
  const list = [...members];
  const openId = list.find((m) => !m.includes('@')) ?? '';
  const email = list.find((m) => m.includes('@')) ?? '';
  if (!openId && !email) return null;
  return { open_id: openId, name: `Fake ${orgKey} Member`, email };
}

/** 无归属账号：优先 NOORG 分组，否则取扁平名单里没被任何分组声明的第一个 open_id */
function pickNoOrgMember(): FakeIdentity | null {
  const explicit = pickGroupMembers('NOORG');
  if (explicit) return explicit;

  const groups = parseOrgGroups(process.env);
  const declared = new Set<string>();
  for (const members of groups.values()) for (const m of members) declared.add(m);
  const orphan = [...parseFlatDirectory(process.env)].find((m) => !m.includes('@') && !declared.has(m));
  return orphan ? { open_id: orphan, name: 'Fake No-Org Member', email: '' } : null;
}

/**
 * 按成员 open_id 精确寻址 —— 分组名查不到时的纯 fallback。
 *
 * 为什么需要它：`pickGroupMembers` 只返回分组里**第一个**非邮箱成员，一个分组只能换出一个人。
 * 而「同组织两个人」是可见性这类断言的最小前提（甲的私有表对乙不可见、同时刻甲自己看得见）——
 * 甲乙若解析成同一个人，那条断言就没有第二个身份可用。
 *
 * 语义：code 尾部的 key 本身就是某个已声明成员的 open_id 时，直接返回那个人。
 * 全部分组都没声明过他 → null（仍按飞书的 "code 无效" 处理，不凭空造身份）。
 */
function pickDeclaredMember(openId: string): FakeIdentity | null {
  const groups = parseOrgGroups(process.env);
  for (const [orgKey, members] of groups) {
    if (members.has(openId)) return { open_id: openId, name: `Fake ${orgKey} Member`, email: '' };
  }
  return null;
}

/**
 * code → 身份。约定 code 以 `code-<key>` 结尾，key 即企业分组名（或 noorg），
 * 分组名未命中时按成员 open_id 精确寻址。认不出来的 code 回 null，
 * 调用方按飞书的 "code 无效" 语义处理。
 *
 * 约定的 code 形态（守卫逐字核对本行）：code-([A-Za-z0-9_]+)$
 * 正则要求 key 内只含 [A-Za-z0-9_]（**不含连字符**）：`code-alice-123` 这种中间夹 `-` 的写法
 * 一律解析为 NULL，调用方拿不到 set-cookie。这是既有约定，调用方按 `code-<open_id>` 构造即可。
 */
export function resolveFakeFeishuIdentity(code: string): FakeIdentity | null {
  const match = /code-([A-Za-z0-9_]+)$/.exec(code.trim());
  if (!match) return null;
  const key = match[1];
  // 既有分支一字不改：noorg 与分组名命中的语义完全照旧，只在"分组名查不到"时才多走一步。
  if (key.toLowerCase() === 'noorg') return pickNoOrgMember();
  return pickGroupMembers(key) ?? pickDeclaredMember(key);
}

const FAKE_APP_ACCESS_TOKEN = 'fake-app-access-token';

/** 两个被顶替的飞书端点的 canned 响应，HTTP 与进程内两条路共用这一份 */
export function fakeFeishuRespond(pathname: string, body: Record<string, unknown>): { status: number; data: unknown } {
  if (pathname.endsWith('/open-apis/auth/v3/app_access_token/internal')) {
    return { status: 200, data: { code: 0, msg: 'ok', app_access_token: FAKE_APP_ACCESS_TOKEN, expire: 7200 } };
  }
  if (pathname.endsWith('/open-apis/authen/v1/access_token')) {
    const code = typeof body?.code === 'string' ? body.code : '';
    const identity = resolveFakeFeishuIdentity(code);
    if (!identity) {
      return { status: 200, data: { code: 20021, msg: 'invalid code (fake upstream)' } };
    }
    return {
      status: 200,
      data: {
        code: 0,
        msg: 'ok',
        data: {
          open_id: identity.open_id,
          name: identity.name,
          email: identity.email,
          access_token: `fake-user-token-${identity.open_id}`,
        },
      },
    };
  }
  return { status: 404, data: { code: 404, msg: 'fake upstream: unknown path' } };
}

// ─── HTTP 形态 ───────────────────────────────────────────────────────────────
router.use((_req: Request, res: Response, next: NextFunction) => {
  if (isProduction()) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  next();
});

router.post('/open-apis/auth/v3/app_access_token/internal', (req: Request, res: Response) => {
  const { status, data } = fakeFeishuRespond('/open-apis/auth/v3/app_access_token/internal', req.body ?? {});
  res.status(status).json(data);
});

router.post('/open-apis/authen/v1/access_token', (req: Request, res: Response) => {
  const { status, data } = fakeFeishuRespond('/open-apis/authen/v1/access_token', req.body ?? {});
  res.status(status).json(data);
});

// ─── 进程内形态 ──────────────────────────────────────────────────────────────
let shimInstalled = false;

function fakeBase(): string {
  return process.env.FEISHU_API_BASE ?? '';
}

/** 只认"配置的上游 base 本身就指向本假上游"这一种情况，其余请求原样放行 */
function targetsFakeUpstream(url: string | undefined): boolean {
  const base = fakeBase();
  if (!url || !base.includes('/api/_smoke/fake-feishu')) return false;
  return url.startsWith(base);
}

const fakeAdapter: AxiosAdapter = async (config) => {
  const url = config.url ?? '';
  const pathname = url.slice(fakeBase().length) || '/';
  let body: Record<string, unknown> = {};
  if (typeof config.data === 'string') {
    try {
      body = JSON.parse(config.data);
    } catch {
      body = {};
    }
  } else if (config.data && typeof config.data === 'object') {
    body = config.data as Record<string, unknown>;
  }
  const { status, data } = fakeFeishuRespond(pathname, body);
  return { data, status, statusText: 'OK', headers: {}, config };
};

/**
 * 装 axios 请求拦截器：把打向假上游 base 的请求切到进程内 adapter。
 * 生产不装（app.ts 条件调用 + 这里再兜一层），装过一次不重复装。
 */
export function installFakeFeishuAxiosShim(): void {
  if (isProduction() || shimInstalled) return;
  shimInstalled = true;

  // 假上游根本不校验应用凭据，但登录路由在缺 FEISHU_APP_ID/SECRET 时会先回 500 ——
  // 没有真凭据的环境（CI / 单测 / 本地）于是连假上游都走不到。这里补 dev 占位值，
  // 与 better-auth 在非生产给 secret 兜底是同一种做法。已显式配置的值一律不动，
  // 生产更不会走到这里（isProduction 已挡）。
  if (!process.env.FEISHU_APP_ID) process.env.FEISHU_APP_ID = 'fake-feishu-app-id';
  if (!process.env.FEISHU_APP_SECRET) process.env.FEISHU_APP_SECRET = 'fake-feishu-app-secret';

  // 单测里 axios 常被 vi.mock 掉，此时 interceptors 是 undefined。挂不上就别挂：
  // 被 mock 的 axios 本来就不会真发请求，假上游没有存在意义；
  // 少了这层判断，app.ts 一 import 就 TypeError，把整批既有 suite 拖成收集失败。
  if (typeof axios.interceptors?.request?.use !== 'function') return;

  axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (targetsFakeUpstream(config.url)) {
      config.adapter = fakeAdapter;
    }
    return config;
  });
}

export default router;
export { router as fakeFeishuRouter };
