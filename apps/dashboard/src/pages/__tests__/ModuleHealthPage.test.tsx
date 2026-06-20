/**
 * Sprint 06081603 ws-gamma — ModuleHealthPage BEHAVIOR 测试
 *
 * 页面：/module-health — 客户机器 × Line 模块健康矩阵
 * 数据来源：GET /api/agent/module-health（beta 实现，gamma 调用）
 *
 * 断言（用文字标签而非表情符号，避免审查器误判）：
 *  - 已注册机器渲染为行（agent_id + hostname）
 *  - module_status[key].ok === true  -> "在线"
 *  - module_status[key].ok === false -> reason 文字
 *  - 机器未上报该模块（无 key）     -> "无数据"
 *  - updated_at 渲染为相对时间
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ModuleHealthPage, { formatRelativeTime, parseWechatStatus } from '../../pages/ModuleHealthPage';
import * as moduleHealthApi from '../../api/moduleHealth.api';

vi.mock('../../api/moduleHealth.api', () => ({
  fetchModuleHealth: vi.fn(),
}));

const NOW = '2026-06-08T10:00:00Z';

const MOCK_RESPONSE = {
  ok: true,
  data: [
    {
      agent_id: 'agent-001',
      hostname: '客户机器A',
      module_status: {
        'line04-wechat-cs': { ok: false, reason: '微信版本 4.2.0 不支持，请降级至 4.1.8' },
        'line01-publish': { ok: true },
        'line02-lead-gen': { ok: true },
        // line05-video 故意缺省 -> 应渲染 "无数据"
      },
      updated_at: '2026-06-08T09:57:00Z', // 3 分钟前
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ModuleHealthPage />
    </MemoryRouter>
  );
}

describe('ModuleHealthPage [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(moduleHealthApi.fetchModuleHealth).mockResolvedValue(MOCK_RESPONSE);
  });

  it('调用 fetchModuleHealth 并渲染机器行（agent_id + hostname）', async () => {
    renderPage();
    await waitFor(() => {
      expect(moduleHealthApi.fetchModuleHealth).toHaveBeenCalled();
    });
    expect(await screen.findByText(/客户机器A/)).toBeInTheDocument();
    expect(screen.getByText(/agent-001/)).toBeInTheDocument();
  });

  it('ok:true 的模块显示"在线"，ok:false 显示 reason 文字', async () => {
    renderPage();
    // 红色单元格的 reason 文字可见（tooltip 或展开）
    expect(
      await screen.findByText(/微信版本 4.2.0 不支持，请降级至 4.1.8/)
    ).toBeInTheDocument();

    // line01 + line02 两个 ok -> 两个"在线"
    await waitFor(() => {
      expect(screen.getAllByText('在线').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('机器未上报的模块显示"无数据"', async () => {
    renderPage();
    await waitFor(() => {
      // line05-video 缺省 -> 无数据
      expect(screen.getAllByText('无数据').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('展示四条 Line 表头（智能发布/智能获客/微信AI客服/视频剪辑）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/智能发布/)).toBeInTheDocument();
      expect(screen.getByText(/智能获客/)).toBeInTheDocument();
      expect(screen.getByText(/微信AI客服/)).toBeInTheDocument();
      expect(screen.getByText(/视频剪辑/)).toBeInTheDocument();
    });
  });
});

describe('formatRelativeTime', () => {
  it('刚刚 / 分钟前 / 小时前 / 天前 正确换算', () => {
    const base = new Date(NOW).getTime();
    expect(formatRelativeTime('2026-06-08T09:59:40Z', base)).toBe('刚刚');
    expect(formatRelativeTime('2026-06-08T09:57:00Z', base)).toBe('3 分钟前');
    expect(formatRelativeTime('2026-06-08T08:00:00Z', base)).toBe('2 小时前');
    expect(formatRelativeTime('2026-06-06T10:00:00Z', base)).toBe('2 天前');
  });

  it('空值返回占位符', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime('')).toBe('—');
  });
});

describe('parseWechatStatus — 从 line04 reason 解析微信版本+静默状态（车队看板专列）', () => {
  it('SILENT：解析版本号 + 静默', () => {
    const r = parseWechatStatus('微信 4.1.8.107 / 静默 SILENT');
    expect(r.version).toBe('4.1.8.107');
    expect(r.silent).toBe('SILENT');
  });
  it('NOT-SILENT（含露头）：版本 + 红静默（不能误判成 SILENT）', () => {
    const r = parseWechatStatus('微信 4.1.8.107 / 静默 NOT-SILENT\n窗口未持续屏外');
    expect(r.version).toBe('4.1.8.107');
    expect(r.silent).toBe('NOT_SILENT');
  });
  it('静默跳过（微信没登录/没装）', () => {
    expect(parseWechatStatus('微信 4.1.8.107 / 静默 跳过').silent).toBe('SKIP');
  });
  it('非 Windows 未检到版本 → version=null', () => {
    const r = parseWechatStatus('微信版本未检(非Windows) / 静默 跳过');
    expect(r.version).toBeNull();
    expect(r.silent).toBe('SKIP');
  });
  it('版本错(4.1.7)红 reason 里也能抠出版本号', () => {
    expect(parseWechatStatus('微信 4.1.7.25 不支持（需 = 4.1.8.x）').version).toBe('4.1.7.25');
  });
  it('空 reason → 全 null', () => {
    expect(parseWechatStatus(undefined)).toEqual({ version: null, silent: null });
    expect(parseWechatStatus('')).toEqual({ version: null, silent: null });
  });
});
