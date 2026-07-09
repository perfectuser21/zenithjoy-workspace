/**
 * SkillEvalPage — X-User-Email 鉴权头回归测试
 *
 * Bug: apps/api/src/middleware/staff.ts 的 staffGuard 强制要求 X-User-Email 头
 * 匹配 STAFF_EMAILS 白名单才放行，但 SkillEvalPage 的上传/轮询 fetch 调用从未
 * 携带这个头 —— 任何账号（包括白名单内的）点上传都会被后端 403 拒绝。
 * 前端 isStaff（侧边栏可见性）跟这里完全是两条独立检查，不能互相替代。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

  // 卸载组件，触发 SkillEvalPage 的卸载清理（stopPolling），避免上一个测试遗留的
  // setTimeout 轮询循环在后台继续跑、偷走下一个测试的 fetch mock 队列（真实复现过
  // 的跨测试串扰：test1 的 upload mock 永远没有 status 字段，poll() 永不停止）
  afterEach(() => {
    cleanup();
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
        json: async () => ({ data: { job_id: 'job-2', status: 'completed' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { verdict: { level: 'pass', text: 'ok' }, summary: '能用' } }),
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

  it('评测完成后拉取报告（GET /api/staff/skill-eval/report/:jobId）携带 X-User-Email 头，并按真实 schema 渲染', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { job_id: 'job-3' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { job_id: 'job-3', status: 'completed' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            skill: { name: 'test-diagnostic-skill' },
            verdict: { level: 'pass', text: '一句话裁决' },
            summary: '能上生产用',
          },
        }),
      } as Response);

    render(<SkillEvalPage />);

    const input = screen.getByTestId('skill-eval-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId('skill-eval-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3), { timeout: 5000 });

    const [reportUrl, reportInit] = fetchSpy.mock.calls[2];
    expect(reportUrl).toBe('/api/staff/skill-eval/report/job-3');
    const headers = new Headers((reportInit as RequestInit)?.headers);
    expect(headers.get('X-User-Email')).toBe('xuxiao21xx@icloud.com');

    await waitFor(() => expect(screen.getByTestId('skill-eval-report')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getAllByText(/能上生产用/).length).toBeGreaterThan(0);
  });

  it('[BEHAVIOR] 真实评测耗时超过60秒仍继续轮询（不提前误报"轮询超时"）——bug: 真实用户上传 朋友圈skill-v1.0.zip 后端已 completed，前端却因 60秒硬超时抢先报错', async () => {
    const t0 = Date.now();
    // 1: 捕获 startedAt；2: 首次 poll 的 elapsed 检查（=0）；3: 第二次 poll 的 elapsed 检查——
    // 模拟真实耗时 70 秒（超过旧的 60 秒硬超时，但远低于 worker 侧 15 分钟才算真 stuck）
    const dateNowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(t0)
      .mockReturnValueOnce(t0)
      .mockReturnValueOnce(t0 + 70_000);

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { job_id: 'job-slow' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { job_id: 'job-slow', status: 'running' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { job_id: 'job-slow', status: 'completed' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { summary: '真实耗时评测也能跑通' } }) } as Response);

    render(<SkillEvalPage />);
    const input = screen.getByTestId('skill-eval-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByTestId('skill-eval-submit'));

    // 70 秒 elapsed 检查发生在第二次真实轮询（POLL_INTERVAL_MS=3s 后），等它跑完
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4), { timeout: 20000 });

    // 不应出现"轮询超时"错误，应该正常展示报告
    expect(screen.queryByTestId('skill-eval-error')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('skill-eval-report')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getAllByText(/真实耗时评测也能跑通/).length).toBeGreaterThan(0);

    dateNowSpy.mockRestore();
  }, 25000);
});
