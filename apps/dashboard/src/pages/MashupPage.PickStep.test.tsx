import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PickStep } from './MashupPage';
import type { DynamicSlot } from '../api/mashup.api';

/**
 * 批量混剪主线入口补齐（GP line05/batch_mashup#step2）：客户原话"我肯定是给你
 * 一个文案，你拿我的素材去帮我做混剪，你现在文案也没有"——PickStep 之前只有
 * 内置模板下拉，没有文案输入。本测试覆盖：
 * ① 文案框先于模板下拉出现（主路径优先，但不强制——不写文案直接用内置模板
 *    的现有路径必须原样能走通）
 * ② degraded=true 时如实告知"AI 分段没跑成，已用固定四槽位继续"，绝不假装成功
 * ③ 分段成功后展示分成几段、每段是什么（match_tags）
 * ④ 请求中/失败态有反馈，不卡死其余交互（模板下拉依旧可点）
 */
afterEach(() => {
  cleanup();
});

const TEMPLATES = [{ id: 'tmpl-1', name: '标准四槽位' }];

const MATERIAL = {
  id: 'm1',
  file_name: 'clip1.mp4',
  size_bytes: 1024,
  mime_type: 'video/mp4',
  taken_at: null,
  created_at: '2026-09-20T10:00:00.000Z',
  preview_url: null,
  tag_status: 'tagged',
  ai_tags: ['开场'],
};

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    templates: TEMPLATES,
    templateId: 'tmpl-1',
    onTemplateChange: vi.fn(),
    templatesLoading: false,
    materials: [] as typeof MATERIAL[],
    materialsLoading: false,
    materialsError: false,
    selectedMaterialIds: new Set<string>(),
    onToggle: vi.fn(),
    onSubmit: vi.fn(),
    submitting: false,
    scriptText: '',
    onScriptChange: vi.fn(),
    onGenerateFromScript: vi.fn(),
    scriptSubmitting: false,
    scriptError: null as string | null,
    scriptResult: null as { degraded: boolean; slots: DynamicSlot[] } | null,
    ...overrides,
  };
}

describe('MashupPage PickStep — 文案分段入口 [BEHAVIOR]', () => {
  it('文案输入框先于套路模板下拉渲染（主路径优先于备选）', () => {
    render(<PickStep {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/文案/);
    const select = document.querySelector('select');
    expect(select).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING = textarea 在 select 之前
    expect(textarea.compareDocumentPosition(select!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('不写文案，直接用内置模板下拉选择仍可提交（现有路径不退化）', () => {
    const onSubmit = vi.fn();
    render(
      <PickStep
        {...baseProps({
          onSubmit,
          materials: [MATERIAL],
          selectedMaterialIds: new Set(['m1']),
        })}
      />,
    );
    fireEvent.click(screen.getByText(/生成槽位分配/));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('文案为空时生成按钮禁用，不允许空文案请求', () => {
    render(<PickStep {...baseProps({ scriptText: '' })} />);
    expect(screen.getByText('按文案生成分段模板').closest('button')).toBeDisabled();
  });

  it('填写文案后点击按钮触发 onGenerateFromScript', () => {
    const onGenerateFromScript = vi.fn();
    render(<PickStep {...baseProps({ scriptText: '这是一段带货文案', onGenerateFromScript })} />);
    fireEvent.click(screen.getByText('按文案生成分段模板'));
    expect(onGenerateFromScript).toHaveBeenCalled();
  });

  it('请求中禁用按钮并显示分段中提示，模板下拉依然可用不卡死', () => {
    render(<PickStep {...baseProps({ scriptText: 'x', scriptSubmitting: true })} />);
    const btn = screen.getByText('AI 分段中…');
    expect(btn.closest('button')).toBeDisabled();
    expect(document.querySelector('select')).toBeTruthy();
  });

  it('失败态展示错误提示，不卡死其余交互', () => {
    render(<PickStep {...baseProps({ scriptText: 'x', scriptError: '文案分段失败：AI 服务超时' })} />);
    expect(screen.getByText('文案分段失败：AI 服务超时')).toBeTruthy();
    expect(document.querySelector('select')).toBeTruthy();
  });

  it('degraded=true 时如实告知客户 AI 分段没跑成，已用固定四槽位继续', () => {
    const slots: DynamicSlot[] = [
      { key: 'hook', required: true, match_tags: ['开场'], suggestedCount: 3, tagMapping: 'matched' },
      { key: 'product', required: true, match_tags: ['产品展示'], suggestedCount: 5, tagMapping: 'matched' },
    ];
    render(
      <PickStep
        {...baseProps({ scriptResult: { degraded: true, slots } })}
      />,
    );
    expect(screen.getByText(/AI 分段没跑成，已用固定四槽位继续/)).toBeTruthy();
  });

  it('AI 分段成功：展示分成几段 + 每段 match_tags，且不出现降级提示', () => {
    const slots: DynamicSlot[] = [
      { key: 'hook', required: true, match_tags: ['开场', '悬念'], suggestedCount: 2, tagMapping: 'matched' },
      { key: 'product', required: true, match_tags: ['产品展示'], suggestedCount: 4, tagMapping: 'matched' },
    ];
    render(<PickStep {...baseProps({ scriptResult: { degraded: false, slots } })} />);
    expect(screen.queryByText(/AI 分段没跑成/)).toBeNull();
    expect(screen.getByText(/2 段/)).toBeTruthy();
    expect(screen.getByText(/开场、悬念/)).toBeTruthy();
    expect(screen.getByText(/产品展示/)).toBeTruthy();
  });
});
