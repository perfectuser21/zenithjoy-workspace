// 客户工作台定义与开户编排。此处只登记外部资源，不另建任务/业务真身。
export type WorkspacePlatform = 'notion' | 'feishu';
export function normalizeWorkspaceParent(platform: WorkspacePlatform, value: string): string {
  if (platform === 'notion') {
    const compact = value.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(compact)) throw Error('Notion parent must be a page UUID');
    return compact;
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw Error('invalid Feishu base token');
  return value;
}
export type WorkspaceField = { name: string; type: 'text' | 'number' | 'checkbox' | 'url'; editable?: boolean };
export type WorkspaceDefinition = { key: string; name: string; source: string; fields: WorkspaceField[] };
const fields = (names: string[], editable = false): WorkspaceField[] => names.map(name => ({ name, type: 'text', editable }));
const base: WorkspaceDefinition[] = [
  { key: 'documents', name: '文档库', source: 'knowledge:primary-platform', fields: fields(['类型', '适用部门', '维护人', '确认状态', '来源链接'], true) },
  { key: 'departments', name: '部门库', source: 'brain:areas', fields: fields(['上级部门', '负责人', '职责']) },
  { key: 'executors', name: '员工与Agent库', source: 'brain:executors', fields: fields(['执行者类型', '所属部门', '职责', '状态']) },
  { key: 'products', name: '产品与服务库', source: 'company-profile:wiki.products', fields: fields(['产品标识', '介绍', '价格说明', '交付内容'], true) },
  { key: 'audiences', name: '客户画像库', source: 'company-profile:wiki.audiences', fields: fields(['画像标识', '需求', '客户特征', '排除条件'], true) },
  { key: 'goals', name: '目标与指标库', source: 'brain:goals', fields: fields(['周期', '负责人', '所属部门', '目标值', '实际值']) },
  { key: 'workflows', name: '已部署工作流库', source: 'brain:workflows+company-profile:runtime_config', fields: fields(['流程标识', '所属部门', '输入说明', '输出说明', '配置版本', '启停状态', '提示词']) },
  { key: 'tasks', name: '任务库', source: 'brain:tasks', fields: fields(['负责人', '期限', '状态', '工作流标识']) },
  { key: 'runs', name: '运行记录库', source: 'brain:ops_runs', fields: fields(['运行标识', '流程标识', '开始时间', '结束时间', '执行结果', '失败原因', '证据链接']) },
  { key: 'devices', name: '设备库', source: 'registry:devices', fields: fields(['设备标识', '设备类型', '在线状态', '所属部门']) },
  { key: 'accounts', name: '平台账号库', source: 'company-profile:runtime_config.platform_accounts', fields: fields(['平台', '原生账号标识', '设备标识', '登录状态', '核验状态']) },
];
const leadgen: WorkspaceDefinition[] = [
  { key: 'keywords', name: '关键词库', source: 'company-profile:runtime_config.search_strategy.keywords', fields: [{ name: '启用', type: 'checkbox', editable: true }, ...fields(['优先级', '时间范围', '排序方式'], true)] },
  { key: 'videos', name: '视频库', source: 'leadgen:videos', fields: [{ name: '视频链接', type: 'url' }, ...fields(['关键词标识', '资格状态', '处理状态', '指标'])] },
  { key: 'comments', name: '评论库', source: 'leadgen:comments', fields: fields(['视频标识', '评论者原生标识', '评论正文', '评分档位', '评分理由', '配置版本']) },
  { key: 'leads', name: '线索库', source: 'leadgen:leads', fields: fields(['平台', '原生账号标识', '来源评论标识', '线索档位', '配送状态']) },
  { key: 'outreach', name: '触达记录库', source: 'leadgen:outreach', fields: fields(['订单标识', '线索标识', '发送账号标识', '批准话术标识', '发送状态', '结果证据']) },
];
export const WORKSPACE_TEMPLATE_VERSION = 1;
export function workspaceTemplate(modules: string[] = []): WorkspaceDefinition[] {
  if (!Array.isArray(modules) || modules.some(m => m !== 'leadgen') || new Set(modules).size !== modules.length) throw Error('unsupported workspace modules');
  return structuredClone([...base, ...(modules.includes('leadgen') ? leadgen : [])]);
}
export type WorkspaceInput = { company_id: string; tenant_id: string; company_name: string; platform: WorkspacePlatform; parent_id: string; modules: string[]; credential_ref?: string };
export type WorkspaceResource = { id: string; marker?: string; status?: string; [key: string]: unknown };
export type WorkspaceState = WorkspaceInput & { template_version: number; status: string; resources: Record<string, WorkspaceResource>; data_sync_status?: string };
export interface WorkspaceAdapter {
  preflight(parent: string): Promise<void>;
  find(parent: string, marker: string, definition: WorkspaceDefinition): Promise<WorkspaceResource[]>;
  create(parent: string, definition: WorkspaceDefinition, marker: string): Promise<WorkspaceResource>;
  verify(parent: string, resource: WorkspaceResource, definition: WorkspaceDefinition, marker: string): Promise<boolean>;
}
export function resourceMarker(input: WorkspaceInput, key: string): string {
  return `customer-workspace:v1:${input.tenant_id}:${input.company_id}:${key}`;
}
export async function provisionWorkspace(input: WorkspaceInput, stored: WorkspaceState, adapter: WorkspaceAdapter, save: (state: WorkspaceState) => Promise<void>): Promise<WorkspaceState> {
  if (normalizeWorkspaceParent(input.platform, input.parent_id) !== input.parent_id) throw Error('workspace parent must be normalized');
  if (['company_id', 'tenant_id', 'platform', 'parent_id'].some(key => input[key as keyof WorkspaceInput] !== stored[key as keyof WorkspaceInput])) throw Error('workspace identity mismatch');
  if (stored.template_version !== WORKSPACE_TEMPLATE_VERSION) throw Error('template upgrade requires explicit migration');
  if (JSON.stringify(input.modules) !== JSON.stringify(stored.modules)) throw Error('module change requires explicit migration');
  const definitions = workspaceTemplate(input.modules), state = structuredClone(stored);
  await adapter.preflight(input.parent_id);
  for (const definition of definitions) {
    const marker = resourceMarker(input, definition.key);
    const saved = state.resources[definition.key];
    try {
      let resource = saved?.id ? saved : undefined;
      if (!resource) {
        const matches = await adapter.find(input.parent_id, marker, definition);
        if (matches.length > 1) throw Error(`ambiguous resource: ${definition.key}`);
        resource = matches[0];
        // 已有未决创建必须查清；不能因暂时列表不可见就重新创建。
        if (!resource && saved?.status === 'creating') throw Error(`unresolved creation: ${definition.key}`);
        if (!resource) {
          state.resources[definition.key] = { id: '', marker, status: 'creating' };
          state.status = 'provisioning'; await save(structuredClone(state));
          try { resource = await adapter.create(input.parent_id, definition, marker); }
          catch (error) {
            // 只有上游明确拒绝、确定没有创建时才允许修复权限后再试。
            if ((error as { definitelyNotCreated?: boolean }).definitelyNotCreated === true) state.resources[definition.key].status = 'rejected_no_create';
            throw error;
          }
        }
      }
      if (typeof resource.id !== 'string' || !resource.id) throw Error(`creation response missing resource id: ${definition.key}`);
      state.resources[definition.key] = { ...resource, marker, status: 'created' };
      await save(structuredClone(state));
      if (!await adapter.verify(input.parent_id, resource, definition, marker)) throw Error(`resource readback failed: ${definition.key}`);
      state.resources[definition.key].status = 'verified'; await save(structuredClone(state));
    } catch (error) {
      state.status = 'needs_reconciliation'; await save(structuredClone(state)); throw error;
    }
  }
  state.status = 'structure_ready'; state.data_sync_status = 'not_connected';
  await save(structuredClone(state)); return state;
}
