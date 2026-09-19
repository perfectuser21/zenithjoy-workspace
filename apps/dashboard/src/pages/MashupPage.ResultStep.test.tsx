import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ResultStep } from './MashupPage';
import type { RenderResult } from '../api/mashup.api';

afterEach(() => {
  cleanup();
});

/**
 * 真机反馈（2026-09-19）：用户选完候选、渲染通过后，页面只给一个"下载成片"链接，
 * 看不到成片长什么样——"选完之后看不到"。补一个内联 <video controls> 直接预览，
 * 不用先下载才能看。
 */
describe('MashupPage ResultStep — 成片预览 [BEHAVIOR]', () => {
  it('审核通过且有 downloadUrl → 渲染内联 video 预览，src 指向 downloadUrl', () => {
    const result: RenderResult = {
      contentId: 'c1',
      safetyCheckStatus: 'passed',
      watermarkCheckStatus: 'passed',
      downloadUrl: 'https://example.com/signed/output.mp4',
    };
    render(<ResultStep result={result} onBack={() => {}} />);
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://example.com/signed/output.mp4');
    expect(video?.hasAttribute('controls')).toBe(true);
  });

  it('审核未通过（failed_pending_review）→ 不渲染 video，保留原有文案', () => {
    const result: RenderResult = {
      contentId: 'c2',
      safetyCheckStatus: 'failed_pending_review',
      watermarkCheckStatus: 'failed_pending_review',
    };
    render(<ResultStep result={result} onBack={() => {}} />);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText(/审核处理中\/暂时失败/)).toBeTruthy();
  });

  it('安全或水印未通过（flagged）→ 不渲染 video', () => {
    const result: RenderResult = {
      contentId: 'c3',
      safetyCheckStatus: 'flagged',
      watermarkCheckStatus: 'passed',
    };
    render(<ResultStep result={result} onBack={() => {}} />);
    expect(document.querySelector('video')).toBeNull();
  });
});
