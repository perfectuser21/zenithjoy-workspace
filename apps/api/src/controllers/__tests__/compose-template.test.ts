import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TemplateSpec } from '../../templates/registry';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: mockQuery } }));

import { _esc, _buildCompositionHtml } from '../ai-video-pipeline-ai.controller';

const SPEC_C: TemplateSpec = {
  id: 'C', name: 'Test C', aspect: '16:9', width: 1920, height: 1080, duration: 10,
  jsxFile: '/fake/template-c.jsx', component: 'SlideC',
  phoneRect: { x: 206, y: 173, w: 328, h: 724 },
};
const SPEC_WG: TemplateSpec = {
  id: 'W-G', name: 'Test WG', aspect: '9:16', width: 1080, height: 1920, duration: 10,
  jsxFile: '/fake/template-wg.jsx', component: 'SlideWG',
  phoneRect: { x: 166, y: 236, w: 388, h: 854 },
};
const SCENES = [
  { start: 0, duration: 5, layout: 'question', eyebrow: 'INTRO', title: '测试标题', body: '测试内容', tags: ['标签1'] },
  { start: 5, duration: 5, layout: 'finale', eyebrow: 'END', title: '结尾', body: '', tags: [] },
];

describe('composeTemplate', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('exports composeTemplate function', async () => {
    const mod = await import('../../controllers/ai-video-pipeline-ai.controller');
    expect(typeof mod.composeTemplate).toBe('function');
  });

  it('returns 404 when job not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { composeTemplate } = await import('../../controllers/ai-video-pipeline-ai.controller');
    const req = { params: { id: 'notfound' }, body: { transcript: 'test', duration: 10 } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();
    await composeTemplate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('_esc', () => {
  it('escapes ampersand', () => { expect(_esc('a&b')).toBe('a&amp;b'); });
  it('escapes < and >', () => { expect(_esc('<b>')).toBe('&lt;b&gt;'); });
  it('escapes double quotes', () => { expect(_esc('"hi"')).toBe('&quot;hi&quot;'); });
  it('handles empty string', () => { expect(_esc('')).toBe(''); });
  it('handles null-like input via cast', () => { expect(_esc(null as unknown as string)).toBe(''); });
  it('leaves plain text unchanged', () => { expect(_esc('hello world')).toBe('hello world'); });
});

describe('_buildCompositionHtml — Template C (16:9)', () => {
  const html = () => _buildCompositionHtml({ scenes: SCENES, gsapJs: '/* gsap */', spec: SPEC_C, duration: 10 });

  it('has data-width and data-height on root div', () => {
    const h = html();
    expect(h).toContain('data-width="1920"');
    expect(h).toContain('data-height="1080"');
  });

  it('has data-duration matching param', () => {
    expect(html()).toContain('data-duration="10"');
  });

  it('includes scene divs for each scene', () => {
    const h = html();
    expect(h).toContain('id="scene-0"');
    expect(h).toContain('id="scene-1"');
  });

  it('renders question layout with qtext class', () => {
    expect(html()).toContain('class="qtext"');
  });

  it('inlines provided GSAP JS', () => {
    expect(html()).toContain('/* gsap */');
  });

  it('includes phone bezel and screen divs', () => {
    const h = html();
    expect(h).toContain('ph-bezel');
    expect(h).toContain('ph-screen');
  });

  it('does NOT include React or Babel CDN scripts', () => {
    const h = html();
    expect(h).not.toContain('react.development.js');
    expect(h).not.toContain('babel.min.js');
  });

  it('escapes HTML in scene content', () => {
    const sceneWithXss = [{ start: 0, duration: 5, layout: 'tags', eyebrow: '<b>X</b>', title: '&amp;', body: '"q"', tags: ['<xss>'] }];
    const h = _buildCompositionHtml({ scenes: sceneWithXss, gsapJs: '', spec: SPEC_C, duration: 5 });
    expect(h).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(h).toContain('&lt;xss&gt;');
  });

  it('content panel is right of phone when phone center-x < canvas-width/2', () => {
    const h = html();
    // phoneCenterX=370 < 960, so content starts right of phone
    expect(h).toContain(`left:${206 + 328 + 56}px`);
  });
});

describe('_buildCompositionHtml — Template W-G (9:16 portrait)', () => {
  const html = () => _buildCompositionHtml({ scenes: SCENES, gsapJs: '', spec: SPEC_WG, duration: 10 });

  it('has correct portrait dimensions', () => {
    const h = html();
    expect(h).toContain('data-width="1080"');
    expect(h).toContain('data-height="1920"');
  });

  it('content panel is below phone for portrait', () => {
    // yStart = 236+854+18+24=1132
    expect(html()).toContain('top:1132px');
  });

  it('uses portrait (smaller) font size for eyebrow', () => {
    expect(html()).toContain('font-size:13px');
  });
});

describe('_buildCompositionHtml — burst layout', () => {
  it('uses burst-num class for big number', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'burst', eyebrow: 'STAT', title: '3.2万', body: '点赞量', tags: [] }];
    const h = _buildCompositionHtml({ scenes, gsapJs: '', spec: SPEC_C, duration: 5 });
    expect(h).toContain('class="burst-num"');
    expect(h).toContain('3.2万');
  });
});

describe('_buildCompositionHtml — no phoneRect', () => {
  it('omits phone elements when phoneRect is absent', () => {
    const specNoPhone: TemplateSpec = { ...SPEC_C, phoneRect: undefined };
    const h = _buildCompositionHtml({ scenes: SCENES, gsapJs: '', spec: specNoPhone, duration: 5 });
    expect(h).not.toContain('ph-bezel');
    expect(h).not.toContain('ph-screen');
  });
});

describe('_buildCompositionHtml — GSAP timeline', () => {
  it('includes tl.to({}) hold at full duration', () => {
    const h = _buildCompositionHtml({ scenes: SCENES, gsapJs: '', spec: SPEC_C, duration: 10 });
    expect(h).toMatch(/tl\.to\(\{\}.*D-\.001/s);
  });

  it('includes window.__hf with seek function', () => {
    const h = _buildCompositionHtml({ scenes: SCENES, gsapJs: '', spec: SPEC_C, duration: 10 });
    expect(h).toContain('window.__hf');
    expect(h).toContain('seek:function');
  });

  it('scene with tags gets tag elements', () => {
    const scenes = [{ start: 0, duration: 5, layout: 'tags', eyebrow: 'KW', title: '关键词', body: '', tags: ['短视频', '精准'] }];
    const h = _buildCompositionHtml({ scenes, gsapJs: '', spec: SPEC_C, duration: 5 });
    expect(h).toContain('class="tag"');
    expect(h).toContain('短视频');
    expect(h).toContain('精准');
  });
});
