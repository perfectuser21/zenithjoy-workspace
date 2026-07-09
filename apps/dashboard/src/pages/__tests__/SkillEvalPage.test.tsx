/**
 * SkillEvalPage — X-User-Email 鉴权头回归测试
 *
 * Bug: apps/api/src/middleware/staff.ts 的 staffGuard 强制要求 X-User-Email 头
 * 匹配 STAFF_EMAILS 白名单才放行，但 SkillEvalPage 的上传/轮询 fetch 调用从未
 * 携带这个头 —— 任何账号（包括白名单内的）点上传都会被后端 403 拒绝。
 * 前端 isStaff（侧边栏可见性）跟这里完全是两条独立检查，不能互相替代。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SkillEvalPage from '../SkillEvalPage';

const mockAuth = vi.hoisted(() => ({
  isSuperAdmin: false,
  isStaff: true,
  user: { id: 'u1', name: '徐啸', email: 'xuxiao21xx@icloud.com' },
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

function makeFile(name = 'skill.zip') {
  return new File(['zip-bytes'], name, { type: 'application/zip' });
}

describe('SkillEvalPage — X-User-Email 鉴权头', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('上传请求（POST /api/staff/skill-eval/upload）携带 X-User-Email 头', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { job_id: 'job-1' } }),
    } as Response);

    render(<SkillEvalPage />);

    const input = screen.getByTestId('skill-eval-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId('skill-eval-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/staff/skill-eval/upload');
    const headers = new Headers((init as RequestInit)?.headers);
    expect(headers.get('X-User-Email')).toBe('xuxiao21xx@icloud.com');
  });

  it('状态轮询请求（GET /api/staff/skill-eval/status/:jobId）携带 X-User-Email 头', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { job_id: 'job-2' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { job_id: 'job-2', status: 'completed', result: { score: 90, summary: 'ok', details: '' } } }),
      } as Response);

    render(<SkillEvalPage />);

    const input = screen.getByTestId('skill-eval-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId('skill-eval-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const [statusUrl, statusInit] = fetchSpy.mock.calls[1];
    expect(statusUrl).toBe('/api/staff/skill-eval/status/job-2');
    const headers = new Headers((statusInit as RequestInit)?.headers);
    expect(headers.get('X-User-Email')).toBe('xuxiao21xx@icloud.com');
  });
});
