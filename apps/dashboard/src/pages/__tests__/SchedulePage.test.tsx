import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SchedulePage from '../SchedulePage';
import { fetchSchedule, slotsOfDay, backlogCount, headroom, type ScheduleSlot } from '../../api/schedule.api';

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

describe('派生计算', () => {
  // 不依赖"现在几点"：mock 的状态按当前时刻推断，CI 在 UTC 跑过会翻车（0920 实证）
  const mk = (status: ScheduleSlot['status']): ScheduleSlot => ({
    id: `s-${status}`, title: 't', dept: '智能获客', planned_at: new Date().toISOString(),
    est_minutes: 10, source: 'recurring', status,
  });

  it('积压只算待跑与被挡住的，不算已完成/进行中/失败', () => {
    expect(backlogCount([mk('queued'), mk('blocked'), mk('done'), mk('running'), mk('failed')])).toBe(2);
    expect(backlogCount([mk('done'), mk('running')])).toBe(0);
  });

  it('按天切片只取当天，且按时刻升序', async () => {
    const { devices } = await fetchSchedule();
    const d = devices.find((x) => x.name === '金诺工作机')!;
    const today = slotsOfDay(d.slots, 0);
    const tomorrow = slotsOfDay(d.slots, 1);
    expect(today.length).toBeGreaterThan(0);
    expect(tomorrow.length).toBeGreaterThan(0);
    expect(today.every((s) => new Date(s.planned_at).toDateString() === new Date().toDateString())).toBe(true);
    expect([...today].sort((a, b) => a.planned_at.localeCompare(b.planned_at))).toEqual(today);
  });

  it('可加量是各业务线剩余之和，且不会为负', () => {
    expect(headroom([{ dept: '智能获客', used: 6, cap: 55, unit: '单' }, { dept: '新媒体部', used: 1, cap: 3, unit: '条' }])).toBe(51);
    expect(headroom([{ dept: '智能获客', used: 70, cap: 55, unit: '单' }])).toBe(0);
  });
});
