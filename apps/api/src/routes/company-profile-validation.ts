// 启用规则的结构验收；草稿允许缺资料，身份关系在所有状态均受保护。
type Data = Record<string, any>;
const object = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function validateCompanyIdentity(next: Data, old: Data): string | null {
  const previousRouting = old.runtime_config?.routing;
  const routing = next.runtime_config?.routing;
  if (previousRouting && ['line_key', 'profiles', 'feishu_base'].some(key => !same(previousRouting[key], routing?.[key]))) return '公司业务线、Profile及飞书身份映射不得经配置编辑修改';
  const base = old.source_evidence?.base ?? previousRouting?.feishu_base;
  const companyKey = old.company_key;
  function foreign(value: unknown, previous: unknown): boolean {
    // 已有证据可来自其他Base（例如跨公司经营目标），原样保留，不把来源升级为归属。
    if (same(value, previous)) return false;
    if (Array.isArray(value)) return value.some((item, index) => foreign(item, Array.isArray(previous) ? previous[index] : undefined));
    if (!object(value)) return false;
    if (value.company_id !== undefined && value.company_id !== old.company_id) return true;
    if (value.tenant_id !== undefined && ![old.tenant_id, companyKey].includes(value.tenant_id)) return true;
    if (value.source_company_key !== undefined && value.source_company_key !== companyKey) return true;
    if (base && value.base !== undefined && value.base !== base) return true;
    return Object.entries(value).some(([key, child]) => foreign(child, object(previous) ? previous[key] : undefined));
  }
  if (foreign(next.wiki, old.wiki) || foreign(next.runtime_config, old.runtime_config) || foreign(next.source_evidence, old.source_evidence)) return '资料、账号或来源引用不属于当前公司';
  const oldAccounts = old.runtime_config?.platform_accounts;
  const accounts = next.runtime_config?.platform_accounts;
  if (accounts !== undefined) {
    if (!Array.isArray(accounts)) return '账号配置必须为数组';
    if (Array.isArray(oldAccounts)) {
      for (const account of accounts) {
        if (!object(account)) return '账号配置格式错误';
        if (account.enabled !== undefined && typeof account.enabled !== 'boolean') return '账号启用开关必须为布尔值';
        if (account.enabled === true && account.verification_status !== 'verified') return '账号归属与设备未经登记器核验，不可启用';
        const original = oldAccounts.find((a: Data) => (a.id ?? a.account_id) === (account.id ?? account.account_id));
        if (!original || !text(account.id ?? account.account_id)) return '新增账号必须先完成公司归属登记';
        // 账号名称可编辑，身份、设备与Profile绑定由登记与核验流程维护。
        const identity = (a: Data) => [a.account_id, a.douyin_id, a.company_id, a.tenant_id, a.profile, a.profile_name, a.device_id, a.device_serial, a.machine_id, a.source, a.verification_status, a.verification_source, a.fields?.手机Profile, a.fields?.抖音号, a.fields?.抖音账号, a.fields?.ADB序列号, a.fields?.绑定机器, a.fields?.业务线, a.fields?.切换标识, a.fields?.最近核验时间, a.fields?.设备];
        if (!same(identity(original), identity(account))) return '账号身份、Profile或设备绑定不得借用其他公司';
      }
    }
  }
  return null;
}
export function validateEnabledCompany(data: Data): string | null {
  const { wiki, runtime_config: runtime } = data;
  const products = wiki.products;
  const audiences = wiki.audiences;
  if (!Array.isArray(products) || !products.length || products.some(p => !object(p) || !text(p.id) || !text(p.name)) || new Set(products.map(p => p.id)).size !== products.length) return '启用需完整且唯一的Wiki产品ID和名称';
  if (!Array.isArray(audiences) || !audiences.length || audiences.some(a => !object(a) || !text(a.id) || !text(a.name)) || new Set(audiences.map(a => a.id)).size !== audiences.length) return '启用需完整且唯一的Wiki客户画像ID和名称';
  const productIds = runtime.product_ids;
  if (!Array.isArray(productIds) || !productIds.length || productIds.some(id => !text(id)) || !same([...productIds].sort(), products.map(p => p.id).sort())) return '运行产品ID必须与本公司Wiki产品一致';
  if (!text(runtime.policy_id)) return '策略ID必填';
  if (!text(runtime.language)) return '语言必填';
  try { if (!Intl.getCanonicalLocales(runtime.language).length || !Intl.DateTimeFormat.supportedLocalesOf(runtime.language).length) return '语言不合法'; } catch { return '语言不合法'; }
  if (!text(runtime.timezone)) return '时区必填';
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: runtime.timezone }); } catch { return '时区不合法'; }
  const routing = runtime.routing;
  if (!object(routing) || !text(routing.line_key) || !text(routing.feishu_base) || !Array.isArray(routing.profiles) || !routing.profiles.length || routing.profiles.some((p: unknown) => !text(p))) return '启用需已关联本公司的业务线和Profile';
  const keywords = runtime.search_strategy?.keywords;
  if (!Array.isArray(keywords) || !keywords.length || keywords.some(k => !object(k) || !text(k.word) || k.word !== k.word.trim() || typeof k.enabled !== 'boolean') || !keywords.some(k => k.enabled)) return '搜索关键词必须为非空规范文本、布尔开关且至少一项启用';
  if (!object(runtime.video_judgment) || !text(runtime.video_judgment.instructions)) return '视频判断规则 instructions 必填';
  const scoring = runtime.comment_scoring;
  if (!object(scoring) || !object(scoring.criteria) || !['A', 'B', 'C', '不相关'].every(key => text(scoring.criteria[key])) || !Number.isFinite(scoring.confidence_threshold) || scoring.confidence_threshold < 0 || scoring.confidence_threshold > 1) return '评论规则需四档描述及0至1的数值阈值';
  return null;
}
