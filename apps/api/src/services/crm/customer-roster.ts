/**
 * customer-roster — 中台 CRM 客户名册聚合（纯函数，环境无关，不连 DB）。
 *
 * 名册 = `cs_memory_messages` distinct 联系人（已聊过的人）∪ `crm_customers` source='manual'
 * 手动加的人 ∪ `wechat_cs_account_config.whitelist` 白名单成员（接管中的人）。
 * 路由层（routes/crm.ts）负责按 req.tenantId scope 查这三处真数据，再把数组喂进本函数做
 * 合并 / 状态规范化 / managed 实时判定。本函数**不触碰 pool**，所以单测无需真 DB。
 *
 * 字段对齐合同 Response Schema（snake_case 裸数据）：
 *   name / contact / wechat_id / status(A1-A5) / last_contact_at(ISO|null) / managed(boolean)
 * 绝不回泄 tenant_id（响应体不含租户 id）。
 */

export type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

const VALID_STATUS: ReadonlySet<string> = new Set(['A1', 'A2', 'A3', 'A4', 'A5']);

/** 把任意输入规范到 A1-A5 之内，非法 / 缺省一律落 'A1'。 */
export function normalizeStatus(s: unknown): CrmStatus {
  return typeof s === 'string' && VALID_STATUS.has(s) ? (s as CrmStatus) : 'A1';
}

/** cs_memory_messages 聚合行（按 tenant×contact distinct + max(created_at)）。 */
export interface RosterMessageRow {
  contact: string;
  wechat_id?: string | null;
  last_contact_at?: string | null;
}

/** 身份三态：customer（普通客户）| blacklist（已拉黑·展示标记）| internal（内部人员，列表已在 SQL 排除）。 */
export type CrmIdentity = 'customer' | 'blacklist' | 'internal';

const VALID_IDENTITY: ReadonlySet<string> = new Set(['customer', 'blacklist', 'internal']);

/** 把任意输入规范到三态之内，非法 / 缺省一律落 'customer'。 */
export function normalizeIdentity(s: unknown): CrmIdentity {
  return typeof s === 'string' && VALID_IDENTITY.has(s) ? (s as CrmIdentity) : 'customer';
}

/** crm_customers 手动入册行。 */
export interface RosterManualRow {
  contact: string;
  name?: string | null;
  wechat_id?: string | null;
  status?: string | null;
  /** 加微信时间 ISO（可空）。 */
  add_friend_time?: string | null;
  /** 身份三态（缺省 customer）。 */
  identity?: string | null;
  /** 该客户所属客服机微信号（前端改身份/状态按此写对号，缺省回退 params.csWechatId）。 */
  cs_wechat_id?: string | null;
}

/** crm_customers source='scan' 扫描好友行（agent 扫客服机近期会话联系人上报落库）。 */
export interface RosterScanRow {
  contact: string;
  name?: string | null;
  wechat_id?: string | null;
  status?: string | null;
  /** 扫描时观测到的最后消息预览（可空）。 */
  last_message?: string | null;
  /** 扫描观测到的最后时间 ISO（可空），并进 last_contact_at。 */
  last_seen_at?: string | null;
  /** 加微信时间 ISO（agent 上报，可空）。 */
  add_friend_time?: string | null;
  /** 身份三态（缺省 customer）。 */
  identity?: string | null;
  /** 该客户所属客服机微信号（前端改身份/状态按此写对号，缺省回退 params.csWechatId）。 */
  cs_wechat_id?: string | null;
}

/** 接管模式：blacklist（主模型，默认全接管 + 黑名单排除）| whitelist（小众兼容，只接管名单内）。 */
export type TakeoverMode = 'blacklist' | 'whitelist';

/** 输出行（合同 GET /api/crm/customers 的 customers[] 元素）。 */
export interface CustomerRosterRow {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  last_contact_at: string | null;
  managed: boolean;
  /** 行来源：message（已聊过）| manual（手动入册）| scan（agent 扫好友）| whitelist（仅接管成员占位）。 */
  source: 'message' | 'manual' | 'scan' | 'whitelist';
  /** 扫描 / 最近一条消息预览（可空）。 */
  last_message: string | null;
  /** 加微信时间 ISO（可空）。 */
  add_friend_time: string | null;
  /** 身份三态（customer/blacklist/internal；internal 已在 SQL 层排除，不会出现在此列表）。 */
  identity: CrmIdentity;
  /** 该客户所属客服机微信号（前端改身份/状态按此写对号；多 cs / super-admin 名册必需）。 */
  cs_wechat_id: string | null;
}

export interface BuildCustomerRosterParams {
  tenantId: string;
  csWechatId: string;
  /**
   * 接管模式。缺省（undefined / 运营没配过接管 / 解析不到 takeover_mode）→ **默认 blacklist 主模型（全接管）**
   * （修 D：旧版缺省回退 whitelist 语义 → whitelist 空 → 全 managed=false → 前台全显"黑名单"，反直觉错误默认）；
   * 'blacklist' → 黑名单主模型（默认全接管，黑名单内排除）；'whitelist' → 仅接管名单内（小众显式兼容）。
   */
  takeoverMode?: TakeoverMode;
  /** 该租户客服机当前白名单（whitelist 模式 / 缺省模式下接管态由它实时决定，非缓存）。 */
  whitelist?: string[];
  /** 该客服机黑名单（blacklist 模式下：managed = contact ∉ blacklist）。 */
  blacklist?: string[];
  /** 已聊过的联系人（由路由查 cs_memory_messages 注入；生产恒传数组，可空）。 */
  messages?: RosterMessageRow[];
  /** 手动入册客户（由路由查 crm_customers source='manual' 注入；生产恒传数组，可空）。 */
  manualCustomers?: RosterManualRow[];
  /** agent 扫描好友（由路由查 crm_customers source='scan' 注入；生产恒传数组，可空）。 */
  scanContacts?: RosterScanRow[];
}

/**
 * 合并名册。身份 key = contact（第一刀用微信昵称，与 blacklist / whitelist / should_reply 的 sender_name 同字面）。
 *
 * 四源合并（同 contact 合并成一行，不重复）：
 *   message（cs_memory_messages 已聊过）∪ manual（crm_customers 手动入册）∪
 *   scan（crm_customers source='scan' agent 扫好友）∪ whitelist 成员（whitelist 模式占位）。
 * 合并优先级：manual 行覆盖 message/scan 的 name/status；scan 补 last_message；message/scan 提供 last_contact_at。
 *
 * managed 实时判定（防前端臆测，列表显示与库当前内容一致）：
 *   - takeoverMode='blacklist' 或缺省（主模型 / 未配接管）：managed = contact ∉ blacklist（默认全接管，黑名单排除）。
 *   - takeoverMode='whitelist'（显式小众）：managed = contact ∈ whitelist。
 */
export async function buildCustomerRoster(
  params: BuildCustomerRosterParams,
): Promise<CustomerRosterRow[]> {
  const mode: TakeoverMode | undefined = params.takeoverMode;
  // 修 D：缺省（未配接管 / 解析不到 takeover_mode）= blacklist 主模型（默认全接管），
  // 不再静默回退 whitelist 语义（whitelist 空 → 全 managed=false → 前台全显"黑名单"，反直觉错误默认）。
  // 仅当显式 'whitelist' 时才走名单内接管语义。
  const isBlacklistMode = mode !== 'whitelist';

  const whitelist = params.whitelist ?? [];
  const wlSet = new Set(whitelist.map((w) => (w ?? '').trim()).filter(Boolean));
  const blacklist = params.blacklist ?? [];
  const blSet = new Set(blacklist.map((b) => (b ?? '').trim()).filter(Boolean));
  const { messages, manualCustomers: manual, scanContacts: scan } = params;

  const byContact = new Map<string, CustomerRosterRow>();

  for (const m of messages ?? []) {
    const contact = (m.contact ?? '').trim();
    if (!contact) continue;
    const prev = byContact.get(contact);
    byContact.set(contact, {
      name: prev?.name ?? contact,
      contact,
      wechat_id: m.wechat_id ?? prev?.wechat_id ?? null,
      status: prev?.status ?? 'A1',
      last_contact_at: m.last_contact_at ?? prev?.last_contact_at ?? null,
      managed: false,
      source: prev?.source ?? 'message',
      last_message: prev?.last_message ?? null,
      add_friend_time: prev?.add_friend_time ?? null,
      identity: prev?.identity ?? 'customer',
      cs_wechat_id: prev?.cs_wechat_id ?? params.csWechatId ?? null,
    });
  }

  // 第四源 scan：与 message/manual 同 key 合并（补 last_message / last_seen → last_contact_at）。
  for (const s of scan ?? []) {
    const contact = (s.contact ?? '').trim();
    if (!contact) continue;
    const prev = byContact.get(contact);
    byContact.set(contact, {
      name: (s.name ?? '').trim() || prev?.name || contact,
      contact,
      wechat_id: s.wechat_id ?? prev?.wechat_id ?? null,
      status: prev ? prev.status : normalizeStatus(s.status),
      last_contact_at: prev?.last_contact_at ?? s.last_seen_at ?? null,
      managed: false,
      // 已聊过的 message/manual 来源优先保留；纯扫进来的标 scan
      source: prev?.source ?? 'scan',
      last_message: s.last_message ?? prev?.last_message ?? null,
      add_friend_time: s.add_friend_time ?? prev?.add_friend_time ?? null,
      identity: prev?.identity ?? normalizeIdentity(s.identity),
      cs_wechat_id: s.cs_wechat_id ?? prev?.cs_wechat_id ?? params.csWechatId ?? null,
    });
  }

  for (const c of manual ?? []) {
    const contact = (c.contact ?? '').trim();
    if (!contact) continue;
    const prev = byContact.get(contact);
    byContact.set(contact, {
      name: (c.name ?? '').trim() || prev?.name || contact,
      contact,
      wechat_id: c.wechat_id ?? prev?.wechat_id ?? null,
      status: normalizeStatus(c.status ?? prev?.status),
      last_contact_at: prev?.last_contact_at ?? null,
      managed: false,
      // manual 显式入册优先覆盖来源标记（除非该 contact 已有 message 来源——保留 message 历史）
      source: prev?.source === 'message' ? 'message' : 'manual',
      last_message: prev?.last_message ?? null,
      add_friend_time: c.add_friend_time ?? prev?.add_friend_time ?? null,
      identity: normalizeIdentity(c.identity ?? prev?.identity),
      cs_wechat_id: c.cs_wechat_id ?? prev?.cs_wechat_id ?? params.csWechatId ?? null,
    });
  }

  // whitelist 模式（仅显式）：名单成员确保入册（接管中但还没聊过 / 没手动加 / 没扫到的人也要出现）。
  // blacklist 主模型 / 缺省不据 whitelist 补行（默认全接管，列表行源 = 实扫/实聊/手动，黑名单只标排除）。
  if (!isBlacklistMode) {
    for (const name of wlSet) {
      if (!byContact.has(name)) {
        byContact.set(name, {
          name,
          contact: name,
          wechat_id: null,
          status: 'A1',
          last_contact_at: null,
          managed: true,
          source: 'whitelist',
          last_message: null,
          add_friend_time: null,
          identity: 'customer',
          cs_wechat_id: params.csWechatId ?? null,
        });
      }
    }
  }

  // managed 实时判定：blacklist 主模型 / 缺省 → ∉ blacklist 即接管（默认全接管）；显式 whitelist → ∈ whitelist 即接管。
  for (const row of byContact.values()) {
    row.managed = isBlacklistMode ? !blSet.has(row.contact) : wlSet.has(row.contact);
  }

  const roster = Array.from(byContact.values());

  // 裸调用（完全无数据源且 whitelist 为空）→ 返回单条占位样本，仅供纯函数形态演示 / 单测断言。
  // 生产路由 routes/crm.ts 恒显式传 messages + manualCustomers + scanContacts 数组（即便为空数组），
  // 绝不进此分支 —— 因此真客户列表永远是真数据，不会混入占位行。
  // 注意：与 takeoverMode 无关（修 D 后缺省=blacklist 主模型；占位样本仍按裸调用判定，不依赖模式）。
  if (
    roster.length === 0 &&
    messages === undefined &&
    manual === undefined &&
    scan === undefined &&
    wlSet.size === 0
  ) {
    return [
      {
        name: '示例客户',
        contact: '示例客户',
        wechat_id: null,
        status: 'A1',
        last_contact_at: null,
        managed: false,
        source: 'manual',
        last_message: null,
        add_friend_time: null,
        identity: 'customer',
        cs_wechat_id: params.csWechatId ?? null,
      },
    ];
  }

  return roster;
}
