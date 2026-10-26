import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'node:util';
import ManualChatImport from '../ManualChatImport';

const text = '2026-10-01 小李：需要100件样品，周五前报价。';
const analysis = {
  summary: '客户希望购买样品',
  needs: [{ text: '100件样品', evidence: '需要100件样品', speaker: '小李', occurred_at: null }],
  quotes: [], commitments: [], next_actions: [], uncertainties: ['尚未确认价格'],
};
const record = { id: 'import-1', customer_id: '12', source_type: 'group',
  channel_name: '采购沟通群', source_account: null, raw_text: text, analysis,
  created_at: '2026-10-26T08:00:00Z', created_by: 'operator-a', source: 'manual_import' };
function response(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}
function preview() {
  return { preview: { id: 'preview-1', version: 'v1', expires_at: new Date(Date.now() + 900_000).toISOString(),
    raw_text: text, source_type: 'group', channel_name: '采购沟通群', source_account: null, analysis } };
}
const props = { customerId: '12', csWechatId: 'cs-a', customerName: '采购公司' };
let fetchMock: ReturnType<typeof vi.fn>;
function form() {
  fireEvent.click(screen.getByRole('button', { name: '补录聊天记录' }));
  fireEvent.change(screen.getByLabelText('会话类型'), { target: { value: 'group' } });
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '采购沟通群' } });
  fireEvent.change(screen.getByLabelText('聊天记录'), { target: { value: text } });
}
async function generate() {
  fireEvent.click(screen.getByRole('button', { name: '整理并预览' }));
  await screen.findByLabelText('整理摘要');
}
beforeEach(() => {
  vi.stubGlobal('TextDecoder', TextDecoder);
  vi.stubGlobal('TextEncoder', TextEncoder);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/preview')) return response(preview());
    if (url.endsWith('/commit')) return response({ record, duplicate: false });
    if (url.includes('/requests/')) return response({ record });
    if (url.includes('/import-1?')) return response({ record });
    if (!init?.method) return response({ records: [] });
    return response({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('手动聊天补录', () => {
  it('没有持久化客户身份时拒绝补录，不从昵称创建身份', () => {
    render(<ManualChatImport {...props} customerId={null} />);
    expect(screen.getByRole('button', { name: '补录聊天记录' })).toBeDisabled();
    expect(screen.getByText(/先.*名册/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('粘贴、群归属、AI预览与明确确认保存完整闭环；刷新可读取原文', async () => {
    const { unmount } = render(<ManualChatImport {...props} />);
    form(); await generate();
    expect(screen.getByText('需要100件样品')).toBeInTheDocument();
    expect(screen.getByText('尚未确认价格')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => c[0].endsWith('/commit'))).toBe(false);
    fireEvent.change(screen.getByLabelText('整理摘要'), { target: { value: '已人工核对的样品需求' } });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await screen.findByText(/保存成功/);
    const call = fetchMock.mock.calls.find(c => c[0].endsWith('/commit'))!;
    expect(JSON.parse(call[1].body as string)).toMatchObject({ customer_id: '12', cs_wechat_id: 'cs-a',
      preview_id: 'preview-1', preview_version: 'v1', confirmed_result: { summary: '已人工核对的样品需求' } });
    expect(call[1].credentials).toBe('include');
    expect(call[1].headers).toEqual({ 'Content-Type': 'application/json' });
    unmount();
    fetchMock.mockImplementation(async (url: string) => response(url.includes('/import-1?') ? { record } : { records: [record] }));
    render(<ManualChatImport {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /查看原文/ }));
    await screen.findByText(text);
  });

  it('严格UTF-8 TXT上传复用粘贴预览请求，不上传文件名', async () => {
    render(<ManualChatImport {...props} />); form();
    fireEvent.change(screen.getByLabelText('上传 TXT'), { target: { files: [new File([text], '记录.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(screen.getByLabelText('聊天记录')).toHaveValue(text));
    await generate();
    const call = fetchMock.mock.calls.find(c => c[0].endsWith('/preview'))!;
    expect(JSON.parse(call[1].body as string)).toMatchObject({ text, customer_id: '12', source_type: 'group', channel_name: '采购沟通群' });
    expect(call[1].body).not.toContain('记录.txt');
  });

  it('无效UTF-8与超限文件不覆盖已输入的文字', async () => {
    render(<ManualChatImport {...props} />); form();
    fireEvent.change(screen.getByLabelText('上传 TXT'), { target: { files: [new File([new Uint8Array([0xc3, 0x28])], 'invalid.txt')] } });
    await screen.findByRole('alert');
    expect(screen.getByLabelText('聊天记录')).toHaveValue(text);
    fireEvent.change(screen.getByLabelText('上传 TXT'), { target: { files: [new File(['中'.repeat(12000)], 'large.txt')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/32|过大|超/));
    expect(screen.getByLabelText('聊天记录')).toHaveValue(text);
    expect(fetchMock.mock.calls.some(c => c[0].endsWith('/preview'))).toBe(false);
  });

  it('模型失败保留原文，取消预览和编辑渠道均不提交旧预览', async () => {
    render(<ManualChatImport {...props} />); form();
    fetchMock.mockImplementationOnce(async () => response({ error: { message: '模型暂不可用' } }, 503));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '整理并预览' })));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('聊天记录')).toHaveValue(text);
    await generate();
    fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '另一个群' } });
    expect(screen.queryByRole('button', { name: '确认保存' })).not.toBeInTheDocument();
    await generate();
    fireEvent.click(screen.getByRole('button', { name: '取消预览' }));
    expect(screen.getByLabelText('聊天记录')).toHaveValue(text);
    expect(fetchMock.mock.calls.some(c => c[0].endsWith('/commit'))).toBe(false);
  });

  it('保存响应丢失先查询原请求，查询成功不重复写入', async () => {
    render(<ManualChatImport {...props} />); form(); await generate();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/commit')) throw new TypeError('network disconnected');
      if (url.includes('/requests/')) return response({ record });
      return response({ records: [record] });
    });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    fireEvent.click(screen.getByRole('button', { name: /保存中|确认保存/ }));
    await screen.findByText(/保存成功/);
    expect(fetchMock.mock.calls.filter(c => c[0].endsWith('/commit'))).toHaveLength(1);
    const commit = fetchMock.mock.calls.find(c => c[0].endsWith('/commit'))!;
    const requestId = JSON.parse(commit[1].body as string).request_id;
    expect(fetchMock.mock.calls.some(c => c[0].includes(`/requests/${requestId}?`))).toBe(true);
  });

  it('提交结果未知时阻止换材料盲重写；查无回执后同一请求安全重试', async () => {
    render(<ManualChatImport {...props} />); form(); await generate();
    let writes = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/commit') && writes++ === 0) throw new TypeError('network disconnected');
      if (url.includes('/requests/')) return response({ error: { message: '尚无回执' } }, 404);
      if (url.endsWith('/commit')) return response({ record, duplicate: false });
      return response({ records: [record] });
    });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await screen.findByRole('button', { name: '核对保存结果' });
    fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
    await screen.findByRole('button', { name: '重试保存' });
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await screen.findByText(/保存成功/);
    const commits = fetchMock.mock.calls.filter(c => c[0].endsWith('/commit'));
    expect(commits).toHaveLength(2);
    expect(JSON.parse(commits[0][1].body as string).request_id).toBe(JSON.parse(commits[1][1].body as string).request_id);
  });

  it('预览请求未返回时编辑原文，丢弃旧响应', async () => {
    render(<ManualChatImport {...props} />); form();
    let resolve!: (v: Response) => void;
    fetchMock.mockImplementation((url: string) => url.endsWith('/preview') ? new Promise<Response>(r => { resolve = r; }) : Promise.resolve(response({ records: [] })));
    fireEvent.click(screen.getByRole('button', { name: '整理并预览' }));
    fireEvent.change(screen.getByLabelText('聊天记录'), { target: { value: '新的原文' } });
    await act(async () => resolve(response(preview())));
    expect(screen.queryByRole('button', { name: '确认保存' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('聊天记录')).toHaveValue('新的原文');
  });
});
