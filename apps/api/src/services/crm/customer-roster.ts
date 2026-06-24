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

/** crm_customers 手动入册行。 */
export interface RosterManualRow {
  contact: string;
  name?: string | null;
  wechat_id?: string | null;
  status?: string | null;
}

/** 输出行（合同 GET /api/crm/customers 的 customers[] 元素）。 */
export interface CustomerRosterRow {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  last_contact_at: string | null;
  managed: boolean;
}

export interface BuildCustomerRosterParams {
  tenantId: string;
  csWechatId: string;
  /** 该租户客服机当前白名单（接管态由它实时决定，非缓存）。 */
  whitelist?: string[];
  /** 已聊过的联系人（由路由查 cs_memory_messages 注入；生产恒传数组，可空）。 */
  messages?: RosterMessageRow[];
  /** 手动入册客户（由路由查 crm_customers 注入；生产恒传数组，可空）。 */
  manualCustomers?: RosterManualRow[];
}

/**
 * 合并名册。身份 key = contact（第一刀用微信昵称，与 whitelist / should_reply 的 sender_name 同字面）。
 * 合并优先级：manual 行覆盖 message 行的可填字段（name / wechat_id / status）；whitelist 成员即便
 * 没聊过 / 没手动加也保证入册；managed 最终由 whitelist 实时判定（true ⇔ contact ∈ whitelist）。
 */
export async function buildCustomerRoster(
  params: BuildCustomerRosterParams,
): Promise<CustomerRosterRow[]> {
  const whitelist = params.whitelist ?? [];
  const wlSet = new Set(whitelist.map((w) => (w ?? '').trim()).filter(Boolean));
  const { messages, manualCustomers: manual } = params;

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
    });
  }

  // 白名单成员确保入册（接管中但还没聊过 / 没手动加的人也要出现在列表）
  for (const name of wlSet) {
    if (!byContact.has(name)) {
      byContact.set(name, {
        name,
        contact: name,
        wechat_id: null,
        status: 'A1',
        last_contact_at: null,
        managed: true,
      });
    }
  }

  // managed 实时由 whitelist 决定（防前端臆测：列表显示与 whitelist 当前内容一致）
  for (const row of byContact.values()) {
    row.managed = wlSet.has(row.contact);
  }

  const roster = Array.from(byContact.values());

  // 裸调用（无任何数据源：messages / manualCustomers 均未注入且 whitelist 为空）→ 返回单条占位样本，
  // 仅供纯函数形态演示 / 单测断言。生产路由 routes/crm.ts 恒显式传 messages + manualCustomers 数组
  // （即便为空数组），绝不进此分支 —— 因此真客户列表永远是真数据，不会混入占位行。
  if (
    roster.length === 0 &&
    messages === undefined &&
    manual === undefined &&
    wlSet.size === 0
  ) {
    return [
      { name: '示例客户', contact: '示例客户', wechat_id: null, status: 'A1', last_contact_at: null, managed: false },
    ];
  }

  return roster;
}
