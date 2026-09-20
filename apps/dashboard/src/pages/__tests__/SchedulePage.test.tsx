import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SchedulePage from '../SchedulePage';

afterEach(cleanup);

const renderPage = () => render(<MemoryRouter><SchedulePage /></MemoryRouter>);

describe('排程看板', () => {
  it('按部门分组渲染，每台设备显示额度与剩余可加量', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: '智能获客' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '新媒体部' })).toBeInTheDocument();
    // 金诺机今日触达 6/55，还能加 49
    const card = screen.getByRole('link', { name: '金诺工作机' }).closest('div.rounded-xl')!;
    expect(within(card as HTMLElement).getByText('6/55单')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('还能加 49 单')).toBeInTheDocument();
  });

  it('设备名链到该机实时画面页', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: '金诺工作机' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '金诺工作机' })).toHaveAttribute(
      'href',
      '/dashboard/workers/8e802deb-247d-4346-8028-03c265959431',
    );
  });

  it('切到明天，看到的是明天的安排', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: '智能获客' })).toBeInTheDocument());
    const card = () => screen.getByRole('link', { name: '金诺工作机' }).closest('div.rounded-xl') as HTMLElement;
    expect(within(card()).queryByText(/转行人工智能/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '明天' }));
    await waitFor(() => expect(within(card()).getByText(/转行人工智能 6 词/)).toBeInTheDocument());
  });

  it('按部门筛选后只剩该部门', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: '新媒体部' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '视频剪辑' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '新媒体部' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '视频剪辑' })).toBeInTheDocument();
  });

  it('被挡住的活显示原因，数据是样例时给出提示', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('素材待审核')).toBeInTheDocument());
    expect(screen.getByText(/样例数据/)).toBeInTheDocument();
  });
});
