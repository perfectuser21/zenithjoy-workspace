// 启用规则的结构验收；草稿允许缺资料，身份关系在所有状态均受保护。
export type CompanyJsonRecord = Record<string, unknown>;
export const companyObject = (value: unknown): value is CompanyJsonRecord => !!value && typeof value === 'object' && !Array.isArray(value);
export const companyRecord = (value: unknown): CompanyJsonRecord => companyObject(value) ? value : {};
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const records = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
interface NamedRecord extends CompanyJsonRecord { id: string; name: string }
const namedRecord = (value: unknown): value is NamedRecord => companyObject(value) && text(value.id) && text(value.name);
interface Keyword { word: string; enabled: boolean }
const keyword = (value: unknown): value is Keyword => companyObject(value) && text(value.word) && value.word === value.word.trim() && typeof value.enabled === 'boolean';

export function validateCompanyIdentity(next: CompanyJsonRecord, old: CompanyJsonRecord): string | null {
  const oldRuntime = companyRecord(old.runtime_config), runtime = companyRecord(next.runtime_config);
  const previousRouting = companyRecord(oldRuntime.routing), routing = companyRecord(runtime.routing);
  if (oldRuntime.routing && ['line_key', 'profiles', 'feishu_base'].some(key => !same(previousRouting[key], routing[key]))) return '公司业务线、Profile及飞书身份映射不得经配置编辑修改';
  const base = companyRecord(old.source_evidence).base ?? previousRouting.feishu_base;
  const companyKey = old.company_key;
  function foreign(value: unknown, previous: unknown): boolean {
    // 已有证据可来自其他Base（例如跨公司经营目标），原样保留，不把来源升级为归属。
    if (same(value, previous)) return false;
    if (Array.isArray(value)) return (value as unknown[]).some((item, index) => foreign(item, Array.isArray(previous) ? previous[index] : undefined));
    if (!companyObject(value)) return false;
    if (value.company_id !== undefined && value.company_id !== old.company_id) return true;
    if (value.tenant_id !== undefined && ![old.tenant_id, companyKey].includes(value.tenant_id)) return true;
    if (value.source_company_key !== undefined && value.source_company_key !== companyKey) return true;
    if (base && value.base !== undefined && value.base !== base) return true;
    return Object.entries(value).some(([key, child]) => foreign(child, companyRecord(previous)[key]));
  }
  if (foreign(next.wiki, old.wiki) || foreign(runtime, oldRuntime) || foreign(next.source_evidence, old.source_evidence)) return '资料、账号或来源引用不属于当前公司';
  const oldAccounts = oldRuntime.platform_accounts, accounts = runtime.platform_accounts;
  if (accounts !== undefined) {
    if (!Array.isArray(accounts)) return '账号配置必须为数组';
    if (!Array.isArray(oldAccounts) && accounts.length) return '新增账号必须先完成公司归属登记';
    if (Array.isArray(oldAccounts)) {
      for (const account of accounts as unknown[]) {
        if (!companyObject(account)) return '账号配置格式错误';
        if (account.enabled !== undefined && typeof account.enabled !== 'boolean') return '账号启用开关必须为布尔值';
        if (account.enabled === true && account.verification_status !== 'verified') return '账号归属与设备未经登记器核验，不可启用';
        const original = (oldAccounts as unknown[]).find((candidate): candidate is CompanyJsonRecord => companyObject(candidate) && (candidate.id ?? candidate.account_id) === (account.id ?? account.account_id));
        if (!original || !text(account.id ?? account.account_id)) return '新增账号必须先完成公司归属登记';
        // 身份、设备与Profile绑定由登记与核验流程维护。
        const identity = (entry: CompanyJsonRecord) => {
          const fields = companyRecord(entry.fields);
          return [entry.account_id, entry.douyin_id, entry.company_id, entry.tenant_id, entry.profile, entry.profile_name, entry.device_id, entry.device_serial, entry.machine_id, entry.source, entry.verification_status, entry.verification_source, fields.手机Profile, fields.抖音号, fields.抖音账号, fields.ADB序列号, fields.绑定机器, fields.业务线, fields.切换标识, fields.最近核验时间, fields.设备];
        };
        if (!same(identity(original), identity(account))) return '账号身份、Profile或设备绑定不得借用其他公司';
      }
    }
  }
  return null;
}
export function validateEnabledCompany(data: CompanyJsonRecord): string | null {
  const wiki = companyRecord(data.wiki), runtime = companyRecord(data.runtime_config);
  const products = records(wiki.products), audiences = records(wiki.audiences);
  if (!products.length || !products.every(namedRecord) || new Set(products.map(p => p.id)).size !== products.length) return '启用需完整且唯一的Wiki产品ID和名称';
  if (!audiences.length || !audiences.every(namedRecord) || new Set(audiences.map(a => a.id)).size !== audiences.length) return '启用需完整且唯一的Wiki客户画像ID和名称';
  const productIds = records(runtime.product_ids);
  if (!productIds.length || !productIds.every(text) || !same([...productIds].sort(), products.map(p => p.id).sort())) return '运行产品ID必须与本公司Wiki产品一致';
  if (!text(runtime.policy_id)) return '策略ID必填';
  if (!text(runtime.language)) return '语言必填';
  try { if (!Intl.getCanonicalLocales(runtime.language).length || !Intl.DateTimeFormat.supportedLocalesOf(runtime.language).length) return '语言不合法'; } catch { return '语言不合法'; }
  if (!text(runtime.timezone)) return '时区必填';
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: runtime.timezone }); } catch { return '时区不合法'; }
  const routing = companyRecord(runtime.routing);
  if (!text(routing.line_key) || !text(routing.feishu_base) || !Array.isArray(routing.profiles) || !routing.profiles.length || !routing.profiles.every(text)) return '启用需已关联本公司的业务线和Profile';
  const keywords = records(companyRecord(runtime.search_strategy).keywords);
  if (!keywords.length || !keywords.every(keyword) || !keywords.some(k => k.enabled)) return '搜索关键词必须为非空规范文本、布尔开关且至少一项启用';
  if (!text(companyRecord(runtime.video_judgment).instructions)) return '视频判断规则 instructions 必填';
  const scoring = companyRecord(runtime.comment_scoring), criteria = companyRecord(scoring.criteria);
  if (!['A', 'B', 'C', '不相关'].every(key => text(criteria[key])) || typeof scoring.confidence_threshold !== 'number' || !Number.isFinite(scoring.confidence_threshold) || scoring.confidence_threshold < 0 || scoring.confidence_threshold > 1) return '评论规则需四档描述及0至1的数值阈值';
  return null;
}
