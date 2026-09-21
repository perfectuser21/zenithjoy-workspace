import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HistoryStep } from './MashupPage';
import type { MashupRunSummary } from '../api/mashup.api';

/**
 * 混剪历史记录 —— run 过去全是组件内存态，刷新即丢，客户跑完候选生成离开就得
 * 从头再来。本组件测试覆盖：四态徽章渲染、点击把 run 交回页面恢复。
 */
afterEach(() => {
  cleanup();
});

const run = (over: Partial<MashupRunSummary>): MashupRunSummary => ({
  runId: 'run-1', templateId: 'tmpl-1', status: 'completed',
  stage: 'candidates_pending', createdAt: '2026-09-20T10:00:00.000Z',
  candidateCount: 3, thumbnailUrl: null, selectedCandidateId: null,
  ...over,
});

describe('MashupPage HistoryStep — 混剪历史 [BEHAVIOR]', () => {
  it('没有历史时给出引导文案，不是空白页', () => {
    render(<HistoryStep runs={[]} loading={false} onOpen={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText(/还没有混剪记录/)).toBeTruthy();
  });

  it('四种状态各自显示可读徽章', () => {
    render(
      <HistoryStep
        runs={[
          run({ runId: 'r-done', stage: 'completed', selectedCandidateId: 'c-1' }),
          run({ runId: 'r-render', stage: 'rendering', selectedCandidateId: 'c-2' }),
          run({ runId: 'r-pending', stage: 'candidates_pending' }),
          run({ runId: 'r-assigned', stage: 'assigned', candidateCount: 0 }),
        ]}
        loading={false}
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('渲染中')).toBeTruthy();
    expect(screen.getByText('候选待选定')).toBeTruthy();
    expect(screen.getByText('待生成候选')).toBeTruthy();
  });

  it('有缩略图就显示，没有则占位不渲染破图', () => {
    render(
      <HistoryStep
        runs={[
          run({ runId: 'r-1', thumbnailUrl: 'https://thumb.example/a.jpg' }),
          run({ runId: 'r-2', thumbnailUrl: null }),
        ]}
        loading={false}
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute('src')).toBe('https://thumb.example/a.jpg');
  });

  it('点一条记录把整个 run 交回页面', () => {
    const onOpen = vi.fn();
    const target = run({ runId: 'r-pending', stage: 'candidates_pending' });
    render(<HistoryStep runs={[target]} loading={false} onOpen={onOpen} onNew={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /候选待选定/ }));

    expect(onOpen).toHaveBeenCalledWith(target);
  });
});
