import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HistoryStep, resolveHistoryTarget } from './MashupPage';
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

describe('resolveHistoryTarget — 历史恢复落点 [BEHAVIOR]', () => {
  it('候选待选定 → 走 listCandidates 恢复候选页，绝不调生成接口', async () => {
    const listCandidates = vi.fn().mockResolvedValue({ runId: 'r-1', candidates: [{ id: 'c-1' }] });
    const getRun = vi.fn().mockResolvedValue({ runId: 'r-1', templateId: 't-1', status: 'completed', assignments: [] });
    const generateCandidates = vi.fn();
    const getCandidateDetail = vi.fn();

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'candidates_pending', candidateCount: 3 }),
      { getRun, listCandidates, getCandidateDetail, generateCandidates },
    );

    expect(target.step).toBe('candidates');
    expect(listCandidates).toHaveBeenCalledWith('r-1');
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it('已完成 → 取候选详情里的 content 落成片页', async () => {
    const content = { contentId: 'ct-1', safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed', downloadUrl: 'https://cdn/a.mp4' };
    const getCandidateDetail = vi.fn().mockResolvedValue({ id: 'c-1', content });

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'completed', selectedCandidateId: 'c-1' }),
      { getRun: vi.fn(), listCandidates: vi.fn(), getCandidateDetail, generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('result');
    expect(getCandidateDetail).toHaveBeenCalledWith('c-1');
    expect(target.renderResult).toEqual(content);
  });

  it('渲染中但 contents 行还没写 → 按待复核呈现，不裸崩', async () => {
    const getCandidateDetail = vi.fn().mockResolvedValue({ id: 'c-1', content: null });

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'rendering', selectedCandidateId: 'c-1' }),
      { getRun: vi.fn(), listCandidates: vi.fn(), getCandidateDetail, generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('result');
    expect(target.renderResult?.safetyCheckStatus).toBe('failed_pending_review');
  });

  it('只分了槽位没候选 → 回到分配页，由客户自己点生成', async () => {
    const getRun = vi.fn().mockResolvedValue({ runId: 'r-1', templateId: 't-1', status: 'completed', assignments: [] });
    const listCandidates = vi.fn();

    const target = await resolveHistoryTarget(
      run({ runId: 'r-1', stage: 'assigned', candidateCount: 0 }),
      { getRun, listCandidates, getCandidateDetail: vi.fn(), generateCandidates: vi.fn() },
    );

    expect(target.step).toBe('assigned');
    expect(getRun).toHaveBeenCalledWith('r-1');
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
