import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RpaMiniView } from './RpaMiniView';
import type { LineState } from '@/shared/types';

describe('RpaMiniView（展开态+RPA进行中：贴边只读缩略）', () => {
  const lines: LineState[] = [
    {
      line: 'line04', connected: true, lightState: 'work',
      activeTasks: [{
        task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三', progress: [2, 5], state: 'work',
      }],
      recentCompleted: [],
    },
    {
      line: 'line02', connected: false, lightState: 'idle', activeTasks: [], recentCompleted: [],
    },
  ];

  it('业务语言渲染 + 无内部代号泄漏', () => {
    const { container } = render(<RpaMiniView lines={lines} />);
    expect(screen.getByText(/智能回复/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/line0[24]/i);
  });

  it('只读：不渲染任何 button/input 等可交互元素', () => {
    render(<RpaMiniView lines={lines} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('异常态(stuck)在mini视图里天然可见，不需要额外升级机制', () => {
    const stuckLines: LineState[] = [{
      line: 'line04', connected: true, lightState: 'stuck', activeTasks: [], recentCompleted: [],
    }];
    render(<RpaMiniView lines={stuckLines} />);
    expect(screen.getByTestId('mini-line04')).toHaveAttribute('data-state', 'stuck');
  });
});
