/**
 * /api/wechat/* — Path 4 微信客服「中台配置」端点（Sprint B）
 *
 * 把 Sprint A 写死在 apps/api/config/*.json 的人设 + 企业知识库「搬上中台」：
 * 运营在页面填、保存即生效（落 zenithjoy.wechat_cs_config，经 cs-config-store 存取）。
 *
 * 5 个端点（鉴权与同 router 其他 /api/wechat/* 端点一致：不挂 superAdminGuard。
 *   原因：superAdminGuard 只认飞书白名单 / 内部 token，**不认 dashboard 的 better-auth
 *   登录 session** → 运营在中台的请求全被 401 拦，加载失败/存不进/AI帮填失败。
 *   中台已在 better-auth 登录 + nginx 后面，这些内部配置端点与 qr-bind/draft-generate
 *   等同 router 端点保持一致即可。后续如需更强鉴权，应换用 better-auth session 感知的中间件）：
 *   - GET  /api/wechat/persona                     → getPersona()
 *   - PUT  /api/wechat/persona                      → 校验 Persona → savePersona() → {success:true}
 *   - GET  /api/wechat/business-kb                  → getBusinessKB()
 *   - PUT  /api/wechat/business-kb                  → 校验 BusinessKB → saveBusinessKB() → {success:true}
 *   - POST /api/wechat/business-kb/suggest-audience → LLM 帮填 A1–A5 人群画像（不写库，前端拿去填表单）
 *
 * 路由路径相对挂载点（lead mount 到 /api/wechat），故此处写 '/persona' 等。
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-config-ui-design.md §2.4
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { callOpenRouter } from '../llm/openrouter';
import {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
  getAutoAgentConfig,
  saveAutoAgentConfig,
} from '../services/wechat/cs-config-store';
import { enqueueKeyContactBroadcast, enqueueSetupSuccess } from '../services/wechat/cs-outbound';
import {
  getCSConfig,
  getCSConfigByMachine,
  saveCSConfig,
  recordIdentityAlert,
  listIdentityAlerts,
  listPendingMachines,
  listAllMachines,
  setupCSByMachine,
} from '../services/wechat/cs-account-config-store';
import { superAdminGuard } from '../middleware/super-admin';
import { tenantContext } from '../middleware/tenant-context';
import {
  requireCsAdminOrSuperAdmin,
  requireCsWriteAccess,
  requireCsReadAccess,
} from '../middleware/cs-config-guard';
import type { KBAudienceSegment } from '../services/wechat/types';

export const wechatConfigRouter = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const PersonaFewShotSchema = z.object({
  customer: z.string(),
  me: z.string(),
});

const PersonaSchema = z
  .object({
    self_name: z.string(),
    address_style: z.string(),
    tone: z.string(),
    sentence_style: z.string(),
    use_emoji: z.string(),
    banned_phrases: z.array(z.string()),
    few_shot: z.array(PersonaFewShotSchema),
  })
  .strict();

const KBCompanySchema = z
  .object({
    name: z.string(),
    what_we_do: z.string(),
    value_prop: z.string(),
    contact: z.string(),
  })
  .strict();

const KBProductSchema = z
  .object({
    name: z.string(),
    selling_points: z.string(),
    price: z.string().optional(),
  })
  .strict();

const KBAudienceSegmentSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    desc: z.string(),
  })
  .strict();

const KBQADocSchema = z
  .object({
    q: z.string(),
    a: z.string(),
  })
  .strict();

const BusinessKBSchema = z
  .object({
    company: KBCompanySchema,
    products: z.array(KBProductSchema),
    audience_segments: z.array(KBAudienceSegmentSchema),
    qa_docs: z.array(KBQADocSchema),
  })
  .strict();

const SuggestAudienceSchema = z
  .object({
    industry: z.string().min(1),
    products: z.string().optional(),
    value_prop: z.string().optional(),
  })
  .strict();

// ─── 校验失败响应（对齐 wechat.ts 的 {error, message, issues} 格式）───────────────

function invalidBody(res: Response, err: z.ZodError) {
  const issues = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  const fields = issues.map((i) => i.path).filter(Boolean).join(',');
  return res.status(400).json({
    error: 'INVALID_BODY',
    message: `字段校验失败: ${fields || 'body'}`,
    issues,
  });
}

// ─── ① 人设 Persona ────────────────────────────────────────────────────────────

wechatConfigRouter.get('/persona', async (_req: Request, res: Response) => {
  const persona = await getPersona();
  return res.status(200).json(persona);
});

wechatConfigRouter.put('/persona', async (req: Request, res: Response) => {
  const parsed = PersonaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  await savePersona(parsed.data);
  return res.status(200).json({ success: true });
});

// ─── ② 企业知识库 BusinessKB ────────────────────────────────────────────────────

wechatConfigRouter.get('/business-kb', async (_req: Request, res: Response) => {
  const kb = await getBusinessKB();
  return res.status(200).json(kb);
});

wechatConfigRouter.put('/business-kb', async (req: Request, res: Response) => {
  const parsed = BusinessKBSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  await saveBusinessKB(parsed.data);
  return res.status(200).json({ success: true });
});

// ─── ③ AI 帮填 A1–A5 人群画像 ────────────────────────────────────────────────────
// 不写库：前端拿返回的 audience_segments 填进表单，用户改完后再走 PUT /business-kb 保存。

/**
 * 从模型自由文本里抠出 JSON 并解析成 audience_segments。
 * 容错：剥 ```json 代码围栏、截取首个 {…} 块，再 JSON.parse。
 * 校验成功返回规整后的 KBAudienceSegment[]；任何失败返回 null。
 */
function parseAudienceSegments(raw: string): KBAudienceSegment[] | null {
  if (!raw) return null;
  let text = raw.trim();
  // 去掉 ```json ... ``` / ``` ... ``` 代码围栏
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 截取首个 { 到末个 } 之间的内容（容忍模型多说了话）
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonSlice = text.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(jsonSlice);
  } catch {
    return null;
  }
  const segs = (obj as { audience_segments?: unknown })?.audience_segments;
  if (!Array.isArray(segs)) return null;

  const cleaned: KBAudienceSegment[] = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    const code = (s as Record<string, unknown>).code;
    const label = (s as Record<string, unknown>).label;
    const desc = (s as Record<string, unknown>).desc;
    if (typeof code !== 'string' || typeof label !== 'string' || typeof desc !== 'string') continue;
    cleaned.push({ code: code.trim(), label: label.trim(), desc: desc.trim() });
  }
  return cleaned.length > 0 ? cleaned : null;
}

function buildSuggestPrompt(input: z.infer<typeof SuggestAudienceSchema>): string {
  const lines = [
    '你是资深私域获客顾问。请基于以下企业信息，提炼 5 类最值得重点触达的目标人群画像。',
    '',
    `行业：${input.industry}`,
  ];
  if (input.products) lines.push(`主营产品 / 服务：${input.products}`);
  if (input.value_prop) lines.push(`核心价值主张：${input.value_prop}`);
  lines.push(
    '',
    '严格只输出如下 JSON，不要任何解释、前后缀或代码围栏：',
    '{"audience_segments":[{"code":"A1","label":"人群名称","desc":"该人群的特征与需求一句话描述"}, ...]}',
    '要求：恰好 5 条，code 依次为 A1、A2、A3、A4、A5；label 简短；desc 一句话点出痛点 / 需求。',
  );
  return lines.join('\n');
}

wechatConfigRouter.post('/business-kb/suggest-audience', async (req: Request, res: Response) => {
  const parsed = SuggestAudienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);

  let content: string;
  try {
    const result = await callOpenRouter({
      prompt: buildSuggestPrompt(parsed.data),
      purpose: 'wechat_suggest_audience',
      maxTokens: 800,
    });
    content = result.content ?? '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[wechat-config/suggest-audience] callOpenRouter 异常:', message);
    return res.status(502).json({ error: 'LLM_FAILED', message });
  }

  const segments = parseAudienceSegments(content);
  if (!segments) {
    return res.status(400).json({ error: 'PARSE_FAILED', message: '模型未返回可解析的人群画像 JSON' });
  }

  return res.status(200).json({ audience_segments: segments });
});

// ─── ④ 自动代理配置（总开关 + 营业时间 + 关键人 + daily_limit）────────────────────
//
// PUT /api/wechat/cs/auto-agent（super-admin）：保存配置 + 在 auto_agent_enabled OFF↔ON
// 跳变时给关键人入「上下线播报」出站任务（agent 拉取后真机 UIA 发送）。

const AutoAgentConfigSchema = z
  .object({
    auto_agent_enabled: z.boolean().optional(),
    business_hours_start: z.string().optional(),
    business_hours_end: z.string().optional(),
    key_contact_wechat: z.string().optional(),
    daily_limit: z.number().int().min(0).optional(),
    // 播报出站任务归属的 agent（NOT NULL uuid）。thin：单租户由调用方传入。
    agent_id: z.string().uuid().optional(),
  })
  .strict();

wechatConfigRouter.get('/cs/auto-agent', superAdminGuard, async (_req: Request, res: Response) => {
  const cfg = await getAutoAgentConfig();
  return res.status(200).json(cfg);
});

// 鉴权升级（Issue 96db53be）：原 superAdminGuard 只认飞书白名单 / internal token，不认
// dashboard better-auth session。改用兼容闸 requireCsAdminOrSuperAdmin —— 既保留 legacy 服务/超管
// 通道（中台→出站任务服务流），又放行 dashboard 租户管理员（session）；member/无凭证 → 403。
wechatConfigRouter.put('/cs/auto-agent', requireCsAdminOrSuperAdmin, async (req: Request, res: Response) => {
  const parsed = AutoAgentConfigSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  const { agent_id, ...cfgPatch } = parsed.data;

  // 跳变检测：取保存前的开关态 + 保存后的开关态
  const before = await getAutoAgentConfig();
  await saveAutoAgentConfig(cfgPatch);
  const after = await getAutoAgentConfig();

  // OFF↔ON 跳变 → 给关键人入上/下线播报出站任务（关键人未配 / 无跳变 → skip，不阻塞保存）。
  let broadcast: { action: string; task_id?: string } = { action: 'skip' };
  if (agent_id) {
    broadcast = await enqueueKeyContactBroadcast({
      prevOn: before.auto_agent_enabled,
      nextOn: after.auto_agent_enabled,
      keyContact: after.key_contact_wechat,
      agentId: agent_id,
    });
  }

  return res.status(200).json({ success: true, config: after, broadcast });
});

// ─── ⑤ 每客服独立配置（按微信号 key 物理分行，多租户隔离）────────────────────────
//
// 钉死 Issue defe1a42 全局单行串台：每客服 = 一个微信号 = 一行配置，写一行不动别人那行。
//
// 鉴权：与本 router 的 /persona、/business-kb 一致 —— 不挂 superAdminGuard。
//   原因同文件头注释：superAdminGuard 在 ZENITHJOY_INTERNAL_TOKEN 已设但请求不带 token 时会 401，
//   而中台前台（better-auth session）和客户机 agent 拉配置都不带该 internal token → 全被拦。
//   配置隔离已由 wechat_id 主 key 保证；客户机身份校验在 /cs/agent-config 内做（未注册号 403 + 写诊断）。

const CSAccountConfigBodySchema = z
  .object({
    persona: PersonaSchema,
    auto_agent_enabled: z.boolean().optional(),
    business_hours_start: z.string().optional(),
    business_hours_end: z.string().optional(),
    key_contact_wechat: z.string().optional(),
    whitelist: z.array(z.string()).optional(),
    daily_limit: z.number().int().min(0).optional(),
  })
  .strict();

// GET /api/wechat/cs/my-role — 供前台渲染只读态（管理员可编辑 / member 只读）
wechatConfigRouter.get('/cs/my-role', tenantContext, (req: Request, res: Response) => {
  const role = req.tenantRole ?? 'member';
  const can_config = role === 'owner' || role === 'admin' || role === 'super-admin';
  return res.status(200).json({ role, can_config });
});

// PUT /api/wechat/cs/config/:wechatId — 按微信号 upsert 该客服那一行（只写该行）
//   安全闸（Issue 96db53be）：tenantContext（401/403 NO_TENANT）→ 管理员角色闸（403 NOT_ADMIN）
//   → 租户隔离（403 CROSS_TENANT / 404 TARGET_NOT_FOUND，deny by default）。
wechatConfigRouter.put(
  '/cs/config/:wechatId',
  requireCsWriteAccess('wechatId'),
  async (req: Request, res: Response) => {
  const wechatId = req.params.wechatId;
  const parsed = CSAccountConfigBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  await saveCSConfig(wechatId, parsed.data);
  const config = await getCSConfig(wechatId);
  return res.status(200).json({ success: true, config });
});

// GET /api/wechat/cs/config/:wechatId — 读该客服那一行供前台编辑
wechatConfigRouter.get('/cs/config/:wechatId', async (req: Request, res: Response) => {
  const config = await getCSConfig(req.params.wechatId);
  if (!config) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '该微信号尚无配置' });
  }
  return res.status(200).json(config);
});

// GET /api/wechat/cs/agent-config — 客户机按自己身份拉自己那份配置。
//   首选 machine_id（决策 143f5d00：客户机可靠持有 machine_id，经 service_agents 反查绑定
//   的 wechat_id；不靠 RPA 读真实微信号）；兼容 wechat_id 直拉（前台/测试）。
//   命中 → 返回该客服那份（含 wechat_id 供客户机软校验）；未绑定/未注册/无行 → 403 且响应体
//   不含任何 persona + 写诊断异常（不泄漏，不串台）。
wechatConfigRouter.get('/cs/agent-config', async (req: Request, res: Response) => {
  const machineId = typeof req.query.machine_id === 'string' ? req.query.machine_id : '';
  const wechatId = typeof req.query.wechat_id === 'string' ? req.query.wechat_id : '';
  const config = machineId
    ? await getCSConfigByMachine(machineId)
    : wechatId
      ? await getCSConfig(wechatId)
      : null;
  if (!config) {
    // 诊断留痕：machine_id 路径记 machine 未绑定/未配；wechat_id 路径记未注册号
    if (machineId) {
      await recordIdentityAlert(machineId, 'unregistered_machine');
    } else {
      await recordIdentityAlert(wechatId || '(empty)', 'unregistered_wechat');
    }
    // 严禁返回任意一份配置（不泄漏 persona）
    return res.status(403).json({
      error: machineId ? 'UNBOUND_MACHINE' : 'UNREGISTERED_WECHAT',
      message: machineId
        ? '这台机器还没配置成客服——去前台「我的客服机」选它，填人设/白名单即可生效（无需任何注册）'
        : '这个微信号还没配置——去前台「我的客服机」配置后生效',
    });
  }
  return res.status(200).json(config);
});

// GET /api/wechat/cs/diagnostics — 诊断页数据源：最近身份校验异常
wechatConfigRouter.get('/cs/diagnostics', async (_req: Request, res: Response) => {
  const alerts = await listIdentityAlerts();
  return res.status(200).json({ alerts });
});

// ─── 一键配置（2026-06-23）：管理员只填人设/白名单/开关，machine_id 自动 ───────────
// GET /api/wechat/cs/pending-machines — 列「在敲门但没配」的机器（机器自己注册上来报到）
wechatConfigRouter.get('/cs/pending-machines', async (_req: Request, res: Response) => {
  const machines = await listPendingMachines();
  return res.status(200).json({ machines });
});

// GET /api/wechat/cs/machines — 列「我的全部客服机」，按账号租户 scope（修「乱列表」）
//   普通租户运营：requireCsReadAccess → tenantContext 解出 req.tenantId → 只列自己租户那台/那几台，
//     别把全平台 20 台（含 E2E 测试机）都倒出来。super-admin 旁路（无 req.tenantId）→ 列全部。
wechatConfigRouter.get('/cs/machines', requireCsReadAccess, async (req: Request, res: Response) => {
  const machines = await listAllMachines(req.tenantId || undefined);
  return res.status(200).json({ machines });
});

const CSSetupBodySchema = z
  .object({
    persona: PersonaSchema,
    auto_agent_enabled: z.boolean().optional(),
    business_hours_start: z.string().optional(),
    business_hours_end: z.string().optional(),
    key_contact_wechat: z.string().optional(),
    whitelist: z.array(z.string()).optional(),
    daily_limit: z.number().int().min(0).optional(),
    wechat_id: z.string().optional(), // 友好名，缺省自动派生 cs-<前缀>
  })
  .strict();

// PUT /api/wechat/cs/setup/:machineId — 一键配置：自动解析租户 + 自动绑定 + 写配置
//   管理员不碰 machine_id（从 pending 列表挑那台机器）；机器没注册过 → 400。
//   安全闸（Issue 96db53be）：tenantContext → 管理员角色闸 → 租户隔离（按 machineId 解析所属租户）。
wechatConfigRouter.put(
  '/cs/setup/:machineId',
  requireCsWriteAccess('machineId'),
  async (req: Request, res: Response) => {
  const parsed = CSSetupBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidBody(res, parsed.error);
  try {
    const { wechat_id, agent_id } = await setupCSByMachine(req.params.machineId, parsed.data);
    const config = await getCSConfig(wechat_id);
    // 设置成功 → 给关键人发一条确认（证明真发链通：中台→出站→客户机 UIA 真发）。失败不阻塞。
    let setup_notice: { task_id?: string } | null = null;
    if (agent_id && config?.key_contact_wechat) {
      setup_notice = await enqueueSetupSuccess({
        keyContact: config.key_contact_wechat,
        agentId: agent_id,
      });
    }
    return res.status(200).json({ success: true, wechat_id, config, setup_notice });
  } catch (e) {
    return res.status(400).json({ error: 'SETUP_FAILED', message: (e as Error).message });
  }
});

export default wechatConfigRouter;
