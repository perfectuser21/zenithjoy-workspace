import { companyRecord, type CompanyJsonRecord as RecordData } from '../routes/company-profile-validation';

export const SOURCE_TABLES = ['products', 'audiences', 'keywords'] as const;
export type SourceTable = (typeof SOURCE_TABLES)[number];
export type SourceRow = { id: string; fields: Record<string, unknown> };
export type SourceRows = Record<SourceTable, SourceRow[]>;

function value(fields: SourceRow['fields'], name: string): string {
  const raw = fields[name];
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
  if (Array.isArray(raw)) return raw.map(item => {
    const part = companyRecord(item);
    return part.plain_text ?? part.text ?? '';
  }).join('').trim();
  return '';
}

const columns = {
  products: { 产品说明: '介绍', 收费模式: '价格说明', 交付方式: '交付内容' },
  audiences: { 核心需求: '需求', 人群描述: '客户特征', 排除信号: '排除条件' },
  keywords: { 优先级: '优先级', 时间窗口天数: '时间范围', 排序方式: '排序方式' },
};

export function previewCompanySource(input: SourceRows) {
  return SOURCE_TABLES.flatMap(table => input[table].map(row => ({
    table,
    title: value(row.fields, '名称'),
    fields: Object.fromEntries(Object.values(columns[table]).map(label => [label, value(row.fields, label)])),
  })));
}

export function importCompanySource(profile: RecordData, input: SourceRows) {
  const wiki = companyRecord(profile.wiki), runtime = companyRecord(profile.runtime_config);
  const search = companyRecord(runtime.search_strategy);
  const build = <T>(table: SourceTable, previous: unknown, convert: (row: RecordData, title: string, input: SourceRow['fields']) => T) => {
    const ids = new Set<string>();
    const existing = (Array.isArray(previous) ? previous : []).map(companyRecord);
    if (!input[table].length) throw Error(`${table} 表没有可导入的记录`);
    return input[table].map(row => {
      const title = value(row.fields, '名称');
      const id = value(row.fields, table === 'products' ? '产品标识' : table === 'audiences' ? '画像标识' : '记录标识') || row.id;
      if (!title || !id || ids.has(id)) throw Error(`${table} 表存在缺失名称、标识或重复标识`);
      ids.add(id);
      const old = existing.find(item => item.id === id) ?? {};
      const fields = { ...companyRecord(old.fields) };
      for (const [key, label] of Object.entries(columns[table])) {
        if (!Object.prototype.hasOwnProperty.call(row.fields, label)) throw Error(`${table} 表缺少列「${label}」`);
        fields[key] = value(row.fields, label);
      }
      return convert({ ...old, id, fields }, title, row.fields);
    });
  };
  const named = (row: RecordData, name: string) => ({ ...row, id: String(row.id), name });
  const products = build('products', wiki.products, named), audiences = build('audiences', wiki.audiences, named);
  const keywords = build('keywords', search.keywords, (row, word, input) => {
    if (typeof input.启用 !== 'boolean' && input.启用 !== undefined) throw Error('关键词启用列必须是复选框');
    return { ...row, word, enabled: input.启用 === true };
  });
  if (new Set(keywords.map(row => row.word)).size !== keywords.length) throw Error('关键词存在重复名称');
  return {
    products: products.map(row => row.name),
    wiki: { ...wiki, products, audiences },
    runtime_config: {
      ...runtime, product_ids: products.map(row => row.id),
      search_strategy: { ...search, keywords },
      video_judgment: { ...companyRecord(runtime.video_judgment), products, audiences },
      comment_scoring: { ...companyRecord(runtime.comment_scoring), audiences },
    },
  };
}
