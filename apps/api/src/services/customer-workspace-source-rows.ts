// 初次资料投递的白名单。只读取明确公司资料，不导出token/设备核验等内部字段。
type Json = Record<string, any>;
export type WorkspaceSourceRow = { object_key: string; source_id: string; title: string; values: Record<string, string | number | boolean> };
const string = (value: unknown): string => value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
export function companyWorkspaceRows(profile: Json, identity: { company_id: string; tenant_id: string }): WorkspaceSourceRow[] {
  if (profile.company_id !== identity.company_id || profile.tenant_id !== identity.tenant_id || !Number.isInteger(profile.config_version)) throw Error('workspace source identity/version mismatch');
  const output: WorkspaceSourceRow[] = [];
  const add = (object_key: string, source_id: string, title: string, values: WorkspaceSourceRow['values']) => {
    if (!source_id || !title) throw Error('source row identity/title missing');
    if (output.some(r => r.object_key === object_key && r.source_id === source_id)) throw Error('duplicate workspace source identity');
    output.push({ object_key, source_id, title, values: { '来源版本': profile.config_version, '同步状态': '初次快照，持续同步未启用', '维护来源': '公司正式配置', ...values } });
  };
  for (const row of profile.wiki?.products ?? []) add('products', row.id, row.name, { '产品标识': row.id, '介绍': string(row.fields?.产品说明), '价格说明': string(row.fields?.收费模式), '交付内容': string(row.fields?.交付方式) });
  for (const row of profile.wiki?.audiences ?? []) add('audiences', row.id, row.name, { '画像标识': row.id, '需求': string(row.fields?.核心需求 ?? row.fields?.意向信号), '客户特征': string(row.fields?.人群描述), '排除条件': string(row.fields?.排除信号) });
  for (const row of profile.runtime_config?.search_strategy?.keywords ?? []) {
    if (typeof row.enabled !== 'boolean') throw Error('keyword enabled must be boolean');
    add('keywords', row.id, row.word, { '启用': row.enabled, '优先级': string(row.fields?.优先级), '时间范围': string(row.fields?.时间窗口天数), '排序方式': string(row.fields?.排序方式) });
  }
  return output;
}
