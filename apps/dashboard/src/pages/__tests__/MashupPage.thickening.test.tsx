// 批量混剪加厚前端（补充测试，dashboard jsdom）：
//  Step2 素材卡片在线预览 <video>；Step3 候选墙虚拟滚动（DOM 节点数远小于候选总数）。
// RED：新组件 MaterialPreviewCard / CandidateWall 尚未从 MashupPage 导出 → import 失败。
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MaterialPreviewCard, CandidateWall } from '../MashupPage';
import type { MashupCandidate } from '../../api/mashup.api';

afterEach(() => {
  cleanup();
});

describe('MashupPage 加厚 [BEHAVIOR]', () => {
  it('Step2 素材卡片渲染 <video>，src 指向 preview_url（可在线播放预览）', () => {
    render(
      <MaterialPreviewCard
        material={{ id: 'm1', file_name: 'a.mp4', mime_type: 'video/mp4', preview_url: 'https://ex.com/signed/a.mp4' }}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toBe('https://ex.com/signed/a.mp4');
  });

  it('Step3 候选墙给 200 条候选时虚拟滚动，渲染 DOM 卡片数远小于 200（非全量）', () => {
    const candidates: MashupCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      score: 200 - i,
      slotFill: { hook: `m${i}` },
      thumbnailUrls: [`https://ex.com/thumb/${i}.jpg`],
    })) as any;
    const { container } = render(<CandidateWall candidates={candidates} onSelect={() => {}} />);
    const cards = container.querySelectorAll('[data-testid="candidate-card"]');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(200); // 虚拟滚动：只渲染可视区，不是 200 全量
  });
});
