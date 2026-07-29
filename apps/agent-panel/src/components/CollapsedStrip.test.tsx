import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollapsedStrip } from './CollapsedStrip';
import type { LineState } from '@/shared/types';
import { lightStateColor } from '@/shared/light-state-color';

const base: LineState = {
  line: 'line04', connected: true, lightState: 'idle', activeTasks: [], recentCompleted: [],
};

// jsdom 把内联 style 的 hex 颜色读回来时会规整成 rgb(...) 形式，用真实DOM渲染出的
// backgroundColor 反过来生成期望值，而不是手写一份平行的hex→rgb映射表。
function hexToRgb(hex: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = hex;
  return probe.style.backgroundColor;
}

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

  it('灯的颜色由 lightState 决定：work=绿 wait=黄 stuck=红 idle=灰（真实渲染出的背景色，不只是data-state标记）', () => {
    const states: LineState['lightState'][] = ['work', 'wait', 'stuck', 'idle'];
    for (const lightState of states) {
      const { unmount } = render(<CollapsedStrip lines={[{ ...base, connected: true, lightState }]} />);
      const lamp = screen.getByTestId('lamp-line04');
      expect(lamp).toHaveAttribute('data-state', lightState);
      expect(lamp.style.backgroundColor).toBe(hexToRgb(lightStateColor(lightState)));
      unmount();
    }
  });

  it('容器渲染panel-collapsed类（深色背景卡片，非默认透明白底）', () => {
    const lines: LineState[] = [{ ...base, connected: true, lightState: 'work' }];
    render(<CollapsedStrip lines={lines} />);
    expect(screen.getByTestId('panel-collapsed').className).toContain('panel-collapsed');
  });

  it('渲染文本里绝不出现内部代号(灯带本身没有文字标签，但data-line属性也不能是原始代号裸露到可见文本)', () => {
    const lines: LineState[] = [{ ...base, connected: true, lightState: 'work' }];
    const { container } = render(<CollapsedStrip lines={lines} />);
    expect(container.textContent).not.toMatch(/line0[24]/i);
  });

  // Sprint 07282119-agent-panel-knife2-android（Golden Path Step 7/8）回归锁定：
  // lamp-line02 与 lamp-line04 独立灯，line02 stuck 态必须正确反映为红态（不合并/不串态）。
  it('收起态灯带 lamp-line02 与 lamp-line04 独立，stuck 态 data-state 正确反映（灯变红）', () => {
    const lines: LineState[] = [
      { ...base, line: 'line04', connected: true, lightState: 'work' },
      { ...base, line: 'line02', connected: true, lightState: 'stuck' },
    ];
    render(<CollapsedStrip lines={lines} />);
    const lamp02 = screen.getByTestId('lamp-line02');
    const lamp04 = screen.getByTestId('lamp-line04');
    expect(lamp02).not.toBe(lamp04);
    expect(lamp02.getAttribute('data-state')).toBe('stuck');
    expect(lamp04.getAttribute('data-state')).toBe('work');
  });
});
