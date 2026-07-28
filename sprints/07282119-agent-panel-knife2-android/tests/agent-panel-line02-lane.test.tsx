/**
 * Sprint 07282119-agent-panel-knife2-android — 合同测试（TDD Red 阶段）
 *
 * 覆盖 Golden Path Step 7/8：apps/agent-panel line02 泳道渲染回归——
 * 真实 render 真实组件（ExpandedPanel/CollapsedStrip），不 mock React 渲染层，
 * 只喂 mock LineState 数据（这是测试输入，不是 mock 被改的边）。
 *
 * 锁定 Invariant「多设备类型UI区分」：line02 与 line04 泳道必须是物理独立的 DOM 节点，
 * 不得被通用组件悄悄合并成一个（decision 8dbe91ee 同源教训——机器管理页历史 bug）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpandedPanel } from '../../../apps/agent-panel/src/components/ExpandedPanel';
import { CollapsedStrip } from '../../../apps/agent-panel/src/components/CollapsedStrip';
import type { LineState } from '../../../apps/agent-panel/src/shared/types';

function buildLines(line02Overrides: Partial<LineState> = {}): LineState[] {
  return [
    {
      line: 'line04',
      connected: true,
      lightState: 'work',
      activeTasks: [{
        task_id: 't-line04-1', line: 'line04', device: 'xian-pc', title: '回复客户张三', progress: [2, 5], state: 'work',
      }],
      recentCompleted: [],
    },
    {
      line: 'line02',
      connected: true,
      lightState: 'stuck',
      activeTasks: [{
        task_id: 't-line02-1', line: 'line02', device: 'RMX3478-b6ee', title: '📱 RMX3478-b6ee 第2/3步', progress: [2, 3], state: 'stuck',
      }],
      recentCompleted: [],
      ...line02Overrides,
    },
  ];
}

describe('line02 泳道渲染回归 [BEHAVIOR]', () => {
  it('lane-line02 与 lane-line04 是两个独立 DOM 节点，不合并显示（Invariant 多设备类型UI区分）', () => {
    render(<ExpandedPanel lines={buildLines()} />);
    const lane02 = screen.getByTestId('lane-line02');
    const lane04 = screen.getByTestId('lane-line04');
    expect(lane02).toBeInTheDocument();
    expect(lane04).toBeInTheDocument();
    expect(lane02).not.toBe(lane04);
    expect(lane02.contains(lane04)).toBe(false);
    expect(lane04.contains(lane02)).toBe(false);
  });

  it('展开态展示设备名格式 <型号>-<agent_id后4位>（如 RMX3478-b6ee），且带步骤进度', () => {
    render(<ExpandedPanel lines={buildLines()} />);
    // 标题字符串本身即含"型号-后4位 第N/M步"格式（title 由上报侧格式化，前端原样透传显示）
    expect(screen.getByText('📱 RMX3478-b6ee 第2/3步')).toBeInTheDocument();
  });

  it('同型号两台设备（RMX3478-b6ee / RMX3478-a1f2）在 line02 泳道内各自独立展示，不合并', () => {
    const lines = buildLines({
      activeTasks: [
        {
          task_id: 't-multi-a', line: 'line02', device: 'RMX3478-b6ee', title: '📱 RMX3478-b6ee 第1/2步', progress: [1, 2], state: 'work',
        },
        {
          task_id: 't-multi-b', line: 'line02', device: 'RMX3478-a1f2', title: '📱 RMX3478-a1f2 第1/2步', progress: [1, 2], state: 'work',
        },
      ],
    });
    render(<ExpandedPanel lines={lines} />);
    expect(screen.getByTestId('task-t-multi-a')).toBeInTheDocument();
    expect(screen.getByTestId('task-t-multi-b')).toBeInTheDocument();
    expect(screen.getByText(/RMX3478-b6ee/)).toBeInTheDocument();
    expect(screen.getByText(/RMX3478-a1f2/)).toBeInTheDocument();
  });

  it('收起态灯带 lamp-line02 与 lamp-line04 独立，stuck 态 data-state 正确反映（灯变红）', () => {
    render(<CollapsedStrip lines={buildLines()} />);
    const lamp02 = screen.getByTestId('lamp-line02');
    const lamp04 = screen.getByTestId('lamp-line04');
    expect(lamp02).not.toBe(lamp04);
    expect(lamp02.getAttribute('data-state')).toBe('stuck');
    expect(lamp04.getAttribute('data-state')).toBe('work');
  });
});
