import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PickStep } from './MashupPage';
import type { DynamicSlot } from '../api/mashup.api';
import type { Material } from '../api/materials.api';

/**
 * 批量混剪横竖屏选择（GP line05/batch_mashup#step4）：客户原话"抖音横屏和竖屏是
 * 我们要选择的呀，有的是横屏，有的是竖屏"——之前界面完全选不了，渲染永远走硬编码
 * 默认横屏。本测试覆盖 PickStep 新增的比例选择区：
 * ① 默认（不传 aspectRatio）预选竖屏，且明确标出"抖音推荐"
 * ② 传入 aspectRatio='landscape' 时横屏态呈选中、竖屏不选中
 * ③ 点击横屏/竖屏分别触发 onAspectRatioChange 回调带正确值
 * ④ 新增区不影响既有"文案输入框先于模板下拉"的相对顺序断言（MashupPage.PickStep.test.tsx）
 *
 * 独立成新文件而不是改现有 MashupPage.PickStep.test.tsx——任务铁律只许碰指定
 * 文件 + 新建测试。新增的 aspectRatio/onAspectRatioChange 均为可选 prop 且有
 * 内部默认值，保证现有测试文件的 baseProps()（不传这两个字段）继续原样通过。
 */
afterEach(() => {
  cleanup();
});

const TEMPLATES = [{ id: 'tmpl-1', name: '标准四槽位' }];

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    templates: TEMPLATES,
    templateId: 'tmpl-1',
    onTemplateChange: vi.fn(),
    templatesLoading: false,
    materials: [] as Material[],
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

describe('MashupPage PickStep — 横竖屏选择 [BEHAVIOR]', () => {
  it('默认预选竖屏 9:16，且标出"抖音推荐"', () => {
    render(<PickStep {...baseProps()} />);
    const portraitBtn = screen.getByText(/竖屏/).closest('button')!;
    const landscapeBtn = screen.getByText(/横屏/).closest('button')!;
    expect(portraitBtn.getAttribute('aria-pressed')).toBe('true');
    expect(landscapeBtn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/抖音推荐/)).toBeTruthy();
  });

  it('传入 aspectRatio="landscape"：横屏呈选中态，竖屏不选中', () => {
    render(<PickStep {...baseProps({ aspectRatio: 'landscape' })} />);
    const portraitBtn = screen.getByText(/竖屏/).closest('button')!;
    const landscapeBtn = screen.getByText(/横屏/).closest('button')!;
    expect(landscapeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(portraitBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('点击横屏触发 onAspectRatioChange("landscape")', () => {
    const onAspectRatioChange = vi.fn();
    render(<PickStep {...baseProps({ aspectRatio: 'portrait', onAspectRatioChange })} />);
    fireEvent.click(screen.getByText(/横屏/).closest('button')!);
    expect(onAspectRatioChange).toHaveBeenCalledWith('landscape');
  });

  it('点击竖屏触发 onAspectRatioChange("portrait")', () => {
    const onAspectRatioChange = vi.fn();
    render(<PickStep {...baseProps({ aspectRatio: 'landscape', onAspectRatioChange })} />);
    fireEvent.click(screen.getByText(/竖屏/).closest('button')!);
    expect(onAspectRatioChange).toHaveBeenCalledWith('portrait');
  });

  it('新增比例选择区不影响既有"文案输入框先于套路模板下拉"的顺序', () => {
    render(<PickStep {...baseProps()} />);
    const textarea = screen.getByPlaceholderText(/文案/);
    const select = document.querySelector('select');
    expect(select).toBeTruthy();
    expect(textarea.compareDocumentPosition(select!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
