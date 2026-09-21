import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CandidatesStep } from './MashupPage';
import type { CandidatesResult } from '../api/mashup.api';

/**
 * 候选真实轻量预览（决策 623a81d7 纠偏 d6bedf80）——用户反馈：纯缩略图拼贴盲选
 * 不满足"合成前先看到片子"的诉求。本组件测试覆盖：预览按钮触发 onPreview、
 * 预览就绪后内联 <video> 替代缩略图播放、生成中禁用按钮不重复触发。
 */
afterEach(() => {
  cleanup();
});

const CANDIDATES: CandidatesResult = {
  runId: 'run-1',
  candidates: [{ id: 'cand-1', score: 1.5, slotFill: { hook: 'mat-1' }, thumbnailUrl: 'https://thumb.example/cand-1.jpg' }],
};

describe('MashupPage CandidatesStep — 候选真实轻量预览 [BEHAVIOR]', () => {
  it('未预览时展示缩略图，点击"先看看效果"触发 onPreview', () => {
    const onPreview = vi.fn();
    render(
      <CandidatesStep
        candidates={CANDIDATES}
        materialsById={new Map()}
        onSelect={vi.fn()}
        rendering={false}
        renderingCandidateId={null}
        previewByCandidate={{}}
        onPreview={onPreview}
      />,
    );
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://thumb.example/cand-1.jpg');
    expect(document.querySelector('video')).toBeNull();

    fireEvent.click(screen.getByText('先看看效果'));
    expect(onPreview).toHaveBeenCalledWith('cand-1');
  });

  it('预览生成中：按钮禁用显示"预览生成中…"，不能重复点击触发', () => {
    const onPreview = vi.fn();
    render(
      <CandidatesStep
        candidates={CANDIDATES}
        materialsById={new Map()}
        onSelect={vi.fn()}
        rendering={false}
        renderingCandidateId={null}
        previewByCandidate={{ 'cand-1': { status: 'generating', url: null } }}
        onPreview={onPreview}
      />,
    );
    const btn = screen.getByText('预览生成中…');
    expect(btn.closest('button')).toBeDisabled();
    fireEvent.click(btn);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('预览就绪：内联 video 替代缩略图，src 指向轻量预览 URL', () => {
    render(
      <CandidatesStep
        candidates={CANDIDATES}
        materialsById={new Map()}
        onSelect={vi.fn()}
        rendering={false}
        renderingCandidateId={null}
        previewByCandidate={{ 'cand-1': { status: 'ready', url: 'https://preview.example/cand-1.mp4' } }}
        onPreview={vi.fn()}
      />,
    );
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://preview.example/cand-1.mp4');
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(document.querySelector('img')).toBeNull();
  });
});
