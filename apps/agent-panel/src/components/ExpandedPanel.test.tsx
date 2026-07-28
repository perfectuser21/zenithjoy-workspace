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

  // ── Sprint 07282119-agent-panel-knife2-android（Golden Path Step 7/8）回归锁定 ──
  // 锁定 Invariant「多设备类型UI区分」：line02(安卓获客) 与 line04 泳道必须是物理独立的
  // DOM 节点，不得被通用组件悄悄合并成一个（decision 8dbe91ee 同源教训——机器管理页历史 bug）。
  it('lane-line02 与 lane-line04 是两个独立 DOM 节点，不合并显示（Invariant 多设备类型UI区分）', () => {
    render(<ExpandedPanel lines={lines} />);
    const lane02 = screen.getByTestId('lane-line02');
    const lane04 = screen.getByTestId('lane-line04');
    expect(lane02).toBeInTheDocument();
    expect(lane04).toBeInTheDocument();
    expect(lane02).not.toBe(lane04);
    expect(lane02.contains(lane04)).toBe(false);
    expect(lane04.contains(lane02)).toBe(false);
  });

  it('展开态展示 line02 设备名格式 <型号>-<agent_id后4位>（如 RMX3478-b6ee），且带步骤进度', () => {
    const line02Lines: LineState[] = lines.map((l) => (l.line === 'line02' ? {
      ...l,
      activeTasks: [{
        task_id: 't-line02-device', line: 'line02', device: 'RMX3478-b6ee', title: '📱 RMX3478-b6ee 第2/3步', progress: [2, 3] as [number, number], state: 'work' as const,
      }],
    } : l));
    render(<ExpandedPanel lines={line02Lines} />);
    // title 由上报侧格式化，前端原样透传显示
    expect(screen.getByText('📱 RMX3478-b6ee 第2/3步')).toBeInTheDocument();
  });

  it('同型号两台设备（RMX3478-b6ee / RMX3478-a1f2）在 line02 泳道内各自独立展示，不合并', () => {
    const multiDeviceLines: LineState[] = lines.map((l) => (l.line === 'line02' ? {
      ...l,
      activeTasks: [
        {
          task_id: 't-multi-a', line: 'line02', device: 'RMX3478-b6ee', title: '📱 RMX3478-b6ee 第1/2步', progress: [1, 2] as [number, number], state: 'work' as const,
        },
        {
          task_id: 't-multi-b', line: 'line02', device: 'RMX3478-a1f2', title: '📱 RMX3478-a1f2 第1/2步', progress: [1, 2] as [number, number], state: 'work' as const,
        },
      ],
    } : l));
    render(<ExpandedPanel lines={multiDeviceLines} />);
    expect(screen.getByTestId('task-t-multi-a')).toBeInTheDocument();
    expect(screen.getByTestId('task-t-multi-b')).toBeInTheDocument();
    expect(screen.getByText(/RMX3478-b6ee/)).toBeInTheDocument();
    expect(screen.getByText(/RMX3478-a1f2/)).toBeInTheDocument();
  });
});
