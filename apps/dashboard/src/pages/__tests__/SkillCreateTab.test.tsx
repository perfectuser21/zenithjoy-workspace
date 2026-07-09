/**
 * SkillCreateTab — 对话式创建 Skill 单元测试
 *
 * sprint_dir: sprints/07091721-conversational-skill-creation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SkillCreateTab from '../SkillCreateTab';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: false,
  isStaff: true,
  user: { id: 'u1', name: '徐啸', email: 'staff@zenithjoy.com' },
  token: 'tok',
  isAuthenticated: true,
  authLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/** 构造一个 body.getReader() 返回固定 SSE 文本块序列的假 Response */
function fakeSseResponse(chunks: string[]): Response {
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = encoder.encode(chunks[i]);
            i += 1;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      }),
    },
  } as unknown as Response;
}

describe('SkillCreateTab', () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('挂载时无 localStorage draft_id → 创建新草稿并存入 localStorage', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-abc', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/staff/skill-drafts');
    expect((init as RequestInit).method).toBe('POST');

    await waitFor(() => expect(localStorage.getItem('skill_draft_id')).toBe('draft-abc'));
  });

  it('挂载时 localStorage 已有 draft_id → GET 拉历史并渲染（断点续聊）', async () => {
    localStorage.setItem('skill_draft_id', 'draft-existing');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          id: 'draft-existing',
          status: 'chatting',
          messages_json: [
            { role: 'user', content: '我想做一个日报skill' },
            { role: 'assistant', content: '好的，说说细节' },
          ],
        },
      }),
    } as Response);

    render(<SkillCreateTab />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/staff/skill-drafts/draft-existing', expect.anything()));
    await waitFor(() => expect(screen.getByText('我想做一个日报skill')).toBeTruthy());
    expect(screen.getByText('好的，说说细节')).toBeTruthy();
  });

  it('发送消息 → SSE 流式渲染 assistant 回复', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-1', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fetchSpy.mockResolvedValueOnce(
      fakeSseResponse([
        'data: {"type":"text","text":"好的"}\n\n',
        'data: {"type":"text","text":"，请描述需求"}\n\nevent: done\ndata: {}\n\n',
      ])
    );

    fireEvent.change(screen.getByTestId('skill-create-input'), { target: { value: '你好' } });
    fireEvent.click(screen.getByTestId('skill-create-send'));

    expect(screen.getByText('你好')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('好的，请描述需求')).toBeTruthy());
  });

  it('输入含"生成吧" → 直接调用 /generate，成功后跳转带 job_id 的 URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-2', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { status: 'done', job_id: 'gen-job-9' } }),
    } as Response);

    fireEvent.change(screen.getByTestId('skill-create-input'), { target: { value: '生成吧' } });
    fireEvent.click(screen.getByTestId('skill-create-send'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/staff/skill-eval?job_id=gen-job-9', { replace: true }));

    const [url, init] = fetchSpy.mock.calls[1];
    expect(url).toBe('/api/staff/skill-drafts/draft-2/generate');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('chat 请求失败 → 展示"AI 暂时连不上，稍后重试"', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-3', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    fireEvent.change(screen.getByTestId('skill-create-input'), { target: { value: '你好' } });
    fireEvent.click(screen.getByTestId('skill-create-send'));

    await waitFor(() => expect(screen.getByText('AI 暂时连不上，稍后重试')).toBeTruthy());
  });

  it('SSE 流中收到 event: error → 展示错误消息', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-4', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fetchSpy.mockResolvedValueOnce(
      fakeSseResponse(['event: error\ndata: {"message":"AI 暂时连不上，稍后重试"}\n\n'])
    );

    fireEvent.change(screen.getByTestId('skill-create-input'), { target: { value: '你好' } });
    fireEvent.click(screen.getByTestId('skill-create-send'));

    await waitFor(() => expect(screen.getByText('AI 暂时连不上，稍后重试')).toBeTruthy());
  });

  it('发送按钮在输入为空或无 draftId 时禁用', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'draft-5', status: 'chatting' } }),
    } as Response);

    render(<SkillCreateTab />);
    const sendBtn = screen.getByTestId('skill-create-send') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('skill-create-input'), { target: { value: '需求描述' } });
    await waitFor(() => expect(sendBtn.disabled).toBe(false));
  });
});
