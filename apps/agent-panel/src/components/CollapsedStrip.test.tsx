import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollapsedStrip } from './CollapsedStrip';
import type { LineState } from '@/shared/types';

const base: LineState = {
  line: 'line04', connected: true, lightState: 'idle', activeTasks: [], recentCompleted: [],
};

describe('CollapsedStrip（收起态边缘灯带）', () => {
  it('只为已接入(connected=true)的线渲染灯，占位线不上灯带', () => {
    const lines: LineState[] = [
      { ...base, line: 'line04', connected: true, lightState: 'work' },
      { ...base, line: 'line02', connected: false, lightState: 'idle' },
    ];
    render(<CollapsedStrip lines={lines} />);
    expect(screen.getAllByTestId(/^lamp-/)).toHaveLength(1);
    expect(screen.getByTestId('lamp-line04')).toBeInTheDocument();
    expect(screen.queryByTestId('lamp-line02')).not.toBeInTheDocument();
  });

  it('灯的颜色由 lightState 决定：work=绿 wait=黄 stuck=红 idle=蓝', () => {
    const lines: LineState[] = [{ ...base, connected: true, lightState: 'stuck' }];
    render(<CollapsedStrip lines={lines} />);
    expect(screen.getByTestId('lamp-line04')).toHaveAttribute('data-state', 'stuck');
  });

  it('渲染文本里绝不出现内部代号(灯带本身没有文字标签，但data-line属性也不能是原始代号裸露到可见文本)', () => {
    const lines: LineState[] = [{ ...base, connected: true, lightState: 'work' }];
    const { container } = render(<CollapsedStrip lines={lines} />);
    expect(container.textContent).not.toMatch(/line0[24]/i);
  });
});
