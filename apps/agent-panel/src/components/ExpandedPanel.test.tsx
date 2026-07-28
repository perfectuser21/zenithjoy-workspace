import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpandedPanel } from './ExpandedPanel';
import type { LineState } from '@/shared/types';

describe('ExpandedPanel（展开态全屏看板）', () => {
  const lines: LineState[] = [
    {
      line: 'line04',
      connected: true,
      lightState: 'work',
      activeTasks: [{
        task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三',
        detail: '第2/5步：读取对话历史', progress: [2, 5], state: 'work',
      }],
      recentCompleted: [],
    },
    {
      line: 'line02',
      connected: true,
      lightState: 'idle',
      activeTasks: [],
      recentCompleted: [{
        task_id: 't2', line: 'line02', device: 'xian-rog', title: '评论区挖客', state: 'done',
      }],
    },
    {
      line: 'publish', connected: false, lightState: 'idle', activeTasks: [], recentCompleted: [],
    },
  ];

  it('正向断言：渲染业务语言(智能回复/智能获客/智能发布)，泳道横向铺开', () => {
    render(<ExpandedPanel lines={lines} />);
    expect(screen.getByText('智能回复')).toBeInTheDocument();
    expect(screen.getByText('智能获客')).toBeInTheDocument();
    expect(screen.getByText('智能发布')).toBeInTheDocument();
  });

  it('负向断言：渲染文本绝不含内部代号 line02/line04', () => {
    const { container } = render(<ExpandedPanel lines={lines} />);
    expect(container.textContent).not.toMatch(/line0[24]/i);
  });

  it('未接入(connected=false)的线显示占位文案，不隐藏', () => {
    render(<ExpandedPanel lines={lines} />);
    expect(screen.getByText(/暂未接入实时看板/)).toBeInTheDocument();
  });

  it('活跃任务展示标题+进度，不截断/不省略号裁切标题内容', () => {
    render(<ExpandedPanel lines={lines} />);
    expect(screen.getByText('回复客户张三')).toBeInTheDocument();
    expect(screen.getByText(/第2\/5步/)).toBeInTheDocument();
  });

  it('最近完成的任务出现在对应泳道', () => {
    render(<ExpandedPanel lines={lines} />);
    expect(screen.getByText('评论区挖客')).toBeInTheDocument();
  });

  it('全空(无任何数据)时不留白吓客户，显示待命文案', () => {
    const emptyLines: LineState[] = [{
      line: 'line04', connected: true, lightState: 'idle', activeTasks: [], recentCompleted: [],
    }];
    render(<ExpandedPanel lines={emptyLines} />);
    expect(screen.getByText(/暂无任务记录/)).toBeInTheDocument();
  });
});
