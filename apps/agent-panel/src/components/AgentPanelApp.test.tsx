import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AgentPanelApp } from './AgentPanelApp';
import type { LineState } from '@/shared/types';

// 首次装机仪式（PrepPRD Golden Path Step1，判定点已登记）：
// Agent首次真正连上中台成功那一刻 → 面板不等召唤，自动全屏展开一次；
// 本地记一次性标记位，只触发一次，往后不再自动弹出。

const lines: LineState[] = [{
  line: 'line04', connected: true, lightState: 'idle', activeTasks: [], recentCompleted: [],
}];

describe('AgentPanelApp（首次装机仪式 + 三态编排）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('首次启动(无本地标记位) → 自动以展开态渲染，并写入标记位', () => {
    render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
    expect(screen.getByTestId('panel-expanded')).toBeInTheDocument();
    expect(window.localStorage.getItem('agent-panel-first-run-shown')).toBe('true');
  });

  it('首次启动展示上线文案+热键提示', () => {
    render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
    expect(screen.getByText(/作战窗已上线/)).toBeInTheDocument();
  });

  it('已有标记位(非首次) → 以收起态渲染，不自动展开', () => {
    window.localStorage.setItem('agent-panel-first-run-shown', 'true');
    render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
    expect(screen.getByTestId('panel-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-expanded')).not.toBeInTheDocument();
  });

  it('rpaActive=true 时，即使处于展开态也渲染贴边只读mini视图，不给全屏', () => {
    window.localStorage.setItem('agent-panel-first-run-shown', 'true');
    const { rerender } = render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
    // 模拟用户手动展开
    act(() => { screen.getByTestId('panel-collapsed').click(); });
    expect(screen.getByTestId('panel-expanded')).toBeInTheDocument();

    rerender(<AgentPanelApp lines={lines} rpaActive connected />);
    expect(screen.getByTestId('panel-rpa-mini')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-expanded')).not.toBeInTheDocument();
  });

  it('展开态期间 RPA 突然开始(props.rpaActive 从false变true) → 立即抢占式收起为贴边态，不等用户手动收起', () => {
    const { rerender } = render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
    // 首次仪式自动是展开态
    expect(screen.getByTestId('panel-expanded')).toBeInTheDocument();

    // 对应真实场景：desktop-lease-broker 轮询查到新租约，父组件把 rpaActive 从 false 改为 true
    rerender(<AgentPanelApp lines={lines} rpaActive connected />);
    expect(screen.getByTestId('panel-rpa-mini')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-expanded')).not.toBeInTheDocument();
  });

  it('connected=false（本机 Agent 本地 SSE 失联）→ 渲染离线/重连中态', () => {
    window.localStorage.setItem('agent-panel-first-run-shown', 'true');
    render(<AgentPanelApp lines={lines} rpaActive={false} connected={false} />);
    expect(screen.getByText(/离线/)).toBeInTheDocument();
  });

  describe('挂载时通知原生宿主初始态（宿主只做窗口力学，不猜React的初始state）', () => {
    afterEach(() => { delete (window as any).chrome; });

    it('首次装机(自动展开)挂载时，立即postMessage告诉宿主expanded=true', () => {
      const postMessage = vi.fn();
      (window as any).chrome = { webview: { postMessage } };
      render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
      expect(postMessage).toHaveBeenCalledWith({ type: 'user-toggle-expand', expanded: true });
    });

    it('非首次(收起态)挂载时，postMessage告诉宿主expanded=false', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      const postMessage = vi.fn();
      (window as any).chrome = { webview: { postMessage } };
      render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
      expect(postMessage).toHaveBeenCalledWith({ type: 'user-toggle-expand', expanded: false });
    });
  });

  describe('响应宿主主动发来的展开态变化（热键/托盘）', () => {
    afterEach(() => { delete (window as any).chrome; });

    it('xian-rog真机验证实测复现：按热键只改了原生窗口几何尺寸，网页expanded状态从未收到通知——'
      + '窗口已变全屏，内容却仍渲染收起态那个6px小灯。收到host-expand-changed消息后必须切到展开态渲染', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      const handlers: Array<(ev: { data: unknown }) => void> = [];
      const addEventListener = vi.fn((_type: string, handler: (ev: { data: unknown }) => void) => {
        handlers.push(handler);
      });
      (window as any).chrome = { webview: { postMessage: vi.fn(), addEventListener } };

      render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
      expect(screen.getByTestId('panel-collapsed')).toBeInTheDocument();

      act(() => { handlers[0]({ data: { type: 'host-expand-changed', expanded: true } }); });
      expect(screen.getByTestId('panel-expanded')).toBeInTheDocument();
    });

    it('收到host-expand-changed(expanded:false)时切回收起态渲染', () => {
      const handlers: Array<(ev: { data: unknown }) => void> = [];
      const addEventListener = vi.fn((_type: string, handler: (ev: { data: unknown }) => void) => {
        handlers.push(handler);
      });
      (window as any).chrome = { webview: { postMessage: vi.fn(), addEventListener } };

      // 首次仪式自动展开
      render(<AgentPanelApp lines={lines} rpaActive={false} connected />);
      expect(screen.getByTestId('panel-expanded')).toBeInTheDocument();

      act(() => { handlers[0]({ data: { type: 'host-expand-changed', expanded: false } }); });
      expect(screen.getByTestId('panel-collapsed')).toBeInTheDocument();
    });
  });

  describe('离线重连摘要横幅（PrepPRD Golden Path Step10）', () => {
    it('reconnectSummary非空 → 渲染"离线期间完成N个任务，失败M个"横幅', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      render(
        <AgentPanelApp
          lines={lines}
          rpaActive={false}
          connected
          reconnectSummary={{ done: 2, failed: 1 }}
          onDismissReconnectSummary={() => {}}
        />,
      );
      expect(screen.getByText(/离线期间完成\s*2\s*个任务，失败\s*1\s*个/)).toBeInTheDocument();
    });

    it('reconnectSummary为null → 不渲染横幅', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      render(
        <AgentPanelApp
          lines={lines}
          rpaActive={false}
          connected
          reconnectSummary={null}
          onDismissReconnectSummary={() => {}}
        />,
      );
      expect(screen.queryByText(/离线期间/)).not.toBeInTheDocument();
    });

    it('点击横幅的关闭按钮 → 调用 onDismissReconnectSummary', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      const onDismiss = vi.fn();
      render(
        <AgentPanelApp
          lines={lines}
          rpaActive={false}
          connected
          reconnectSummary={{ done: 1, failed: 0 }}
          onDismissReconnectSummary={onDismiss}
        />,
      );
      act(() => { screen.getByTestId('reconnect-summary-dismiss').click(); });
      expect(onDismiss).toHaveBeenCalled();
    });

    // xian-rog真机截图实测发现：整个作战窗展开态是纯白底黑字，无任何视觉设计——
    // 设计稿(2026-07-22-agent-panel-design.md)要求的slate深底面板从未真正落地。
    it('渲染panel-banner样式（横幅非纯文本裸露）', () => {
      window.localStorage.setItem('agent-panel-first-run-shown', 'true');
      render(
        <AgentPanelApp
          lines={lines}
          rpaActive={false}
          connected
          reconnectSummary={{ done: 1, failed: 0 }}
          onDismissReconnectSummary={() => {}}
        />,
      );
      expect(screen.getByTestId('reconnect-summary-banner').className).toContain('panel-banner');
    });
  });
});
