import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AidgeWorkspacePage from '../AidgeWorkspacePage';
import { autopilotNavGroups } from '../../config/navigation.config';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(useAuth).mockReset();
});

const operations = [
  {
    id: 'textTranslate',
    label: '文本翻译',
    category: '翻译',
    documentation: 'https://api.aliyun.com/document/Aidge/2026-04-28/TextTranslate',
    destructive: false,
    fields: [
      { name: 'sourceTextList', apiName: 'SourceTextList', kind: 'array' },
      { name: 'targetLanguage', apiName: 'TargetLanguage', kind: 'string' },
    ],
  },
  {
    id: 'imageMatting',
    label: '智能抠图',
    category: '图片处理',
    documentation: 'https://api.aliyun.com/document/Aidge/2026-04-28/ImageMatting',
    destructive: false,
    fields: [{ name: 'imageUrl', apiName: 'ImageUrl', kind: 'string' }],
  },
];

describe('Aidge 工作台', () => {
  it('是员工侧一级菜单，列出能力栏目并可执行 SDK 接口', async () => {
    vi.mocked(useAuth).mockReturnValue({ isAidgeOnly: false } as ReturnType<typeof useAuth>);
    expect(autopilotNavGroups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/aidge', label: 'Aidge', requireStaff: true }),
      ])
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ operations }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ Code: 'success', Data: { ImageUrl: 'https://example.com/result.png' } }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <AidgeWorkspacePage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: /图片处理/ }));
    fireEvent.click(screen.getByRole('button', { name: /智能抠图/ }));
    fireEvent.change(screen.getByLabelText('ImageUrl'), {
      target: { value: 'https://example.com/photo.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: '运行能力' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/aidge/execute',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            operation: 'imageMatting',
            params: { imageUrl: 'https://example.com/photo.png' },
          }),
        })
      )
    );
    expect(await screen.findByText(/result\.png/)).toBeInTheDocument();
  });

  it('试用账号看不到创作画布入口', async () => {
    vi.mocked(useAuth).mockReturnValue({ isAidgeOnly: true } as ReturnType<typeof useAuth>);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ operations }), { status: 200 })));
    render(<MemoryRouter><AidgeWorkspacePage /></MemoryRouter>);
    expect(await screen.findByText('Aidge 试用')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /前往创作画布/ })).not.toBeInTheDocument();
  });
});
