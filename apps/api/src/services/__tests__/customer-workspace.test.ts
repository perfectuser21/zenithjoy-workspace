import { describe, expect, it } from 'vitest';
import { workspaceTemplate, provisionWorkspace, normalizeWorkspaceParent, type WorkspaceState, type WorkspaceAdapter } from '../customer-workspace';

const input = { company_id: 'company-a', tenant_id: 'tenant-a', company_name: '甲公司', platform: 'notion' as const, parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', modules: ['leadgen'] };
function harness() {
  let state: WorkspaceState = { ...input, template_version: 1, status: 'pending', resources: {} };
  const remote = new Map<string, { id: string; marker: string }>();
  let creates = 0, fail = '';
  const adapter: WorkspaceAdapter = {
    preflight: async () => {},
    find: async (_parent, marker) => [...remote.values()].filter(x => x.marker === marker),
    create: async (_parent, definition, marker) => {
      creates++; const value = { id: `remote-${creates}`, marker }; remote.set(value.id, value);
      if (definition.key === fail) throw Error('response lost');
      return value;
    },
    verify: async (_parent, value, _definition, marker) => remote.get(value.id)?.marker === marker,
  };
  return { adapter, remote, state: () => state, save: async (s: WorkspaceState) => { state = structuredClone(s); }, creates: () => creates, fail: (key: string) => { fail = key; } };
}
describe('客户工作台完整开户与恢复', () => {
  it('Notion同一UUID只登记一个parent，飞书token区分大小写', () => {
    expect(normalizeWorkspaceParent('notion', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(input.parent_id);
    expect(normalizeWorkspaceParent('feishu', 'BaseAa')).toBe('BaseAa');
  });
  it('基础11类、获客增5类；非法模块拒绝', () => {
    expect(workspaceTemplate([])).toHaveLength(11);
    expect(workspaceTemplate(['leadgen'])).toHaveLength(16);
    expect(new Set(workspaceTemplate(['leadgen']).map(x => x.key)).size).toBe(16);
    expect(() => workspaceTemplate(['unknown'])).toThrow();
  });
  it('两次开户仍只有16个资源，全部独立读回后才报结构就绪', async () => {
    const h = harness();
    await provisionWorkspace(input, h.state(), h.adapter, h.save);
    expect(h.state().status).toBe('structure_ready');
    expect(h.creates()).toBe(16);
    expect(h.state().data_sync_status).toBe('not_connected');
    await provisionWorkspace(input, h.state(), h.adapter, h.save);
    expect(h.creates()).toBe(16);
  });
  it('创建成功但响应丢失，重跑先查原资源不重复建', async () => {
    const h = harness(); h.fail('products');
    await expect(provisionWorkspace(input, h.state(), h.adapter, h.save)).rejects.toThrow('response lost');
    expect(h.state().status).toBe('needs_reconciliation');
    h.fail(''); await provisionWorkspace(input, h.state(), h.adapter, h.save);
    expect(h.creates()).toBe(16);
  });
  it('公司、租户、平台或父位置变化，在任何外部动作前拒绝', async () => {
    for (const edit of [{ tenant_id: 'foreign' }, { company_id: 'foreign' }, { platform: 'feishu' }, { parent_id: 'foreign' }]) {
      const h = harness();
      await expect(provisionWorkspace(input, { ...h.state(), ...edit } as WorkspaceState, h.adapter, h.save)).rejects.toThrow('identity');
      expect(h.creates()).toBe(0);
    }
  });
  it('同一标记找到两个目标必须停，不猜其中一个', async () => {
    const h = harness(); h.adapter.find = async () => [{ id: 'one' }, { id: 'two' }];
    await expect(provisionWorkspace(input, h.state(), h.adapter, h.save)).rejects.toThrow('ambiguous');
    expect(h.creates()).toBe(0);
  });
  it('读回失败不报成功且保留目标ID', async () => {
    const h = harness(); h.adapter.verify = async () => false;
    await expect(provisionWorkspace(input, h.state(), h.adapter, h.save)).rejects.toThrow('readback');
    expect(Object.values(h.state().resources)[0].id).toBeTruthy();
    expect(h.state().status).toBe('needs_reconciliation');
  });
  it('保存创建意图失败时不得发送创建请求', async () => {
    const h = harness();
    await expect(provisionWorkspace(input, h.state(), h.adapter, async () => { throw Error('DB unavailable'); })).rejects.toThrow();
    expect(h.creates()).toBe(0);
  });
  it('明确403拒绝后可修权限重试，未知创建且查不到则始终禁止重发', async () => {
    const h = harness(); const original = h.adapter.create;
    h.adapter.create = async () => { throw Object.assign(Error('HTTP 403'), { definitelyNotCreated: true }); };
    await expect(provisionWorkspace(input, h.state(), h.adapter, h.save)).rejects.toThrow('403');
    expect(h.state().resources.documents.status).toBe('rejected_no_create');
    h.adapter.create = original; await provisionWorkspace(input, h.state(), h.adapter, h.save);
    expect(h.creates()).toBe(16);
    const u = harness(); u.adapter.create = async () => { throw Error('timeout'); };
    await expect(provisionWorkspace(input, u.state(), u.adapter, u.save)).rejects.toThrow('timeout');
    u.adapter.create = original;
    await expect(provisionWorkspace(input, u.state(), u.adapter, u.save)).rejects.toThrow('unresolved creation');
  });
});
