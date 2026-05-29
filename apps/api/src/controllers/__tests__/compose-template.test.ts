import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { TemplateSpec } from '../../templates/registry';
import type { Request, Response, NextFunction } from 'express';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: mockQuery } }));

// Make https.request fail immediately so postJson (OpenRouter call) rejects fast.
// composeTemplate has a try-catch that falls back to derived sceneTexts, so the
// controller still runs to completion and we can assert on the JSON response shape.
vi.mock('https', () => ({
  default: {
    request: vi.fn(() => {
      const req = {
        on(event: string, handler: (e: Error) => void) {
          if (event === 'error') process.nextTick(() => handler(new Error('https mocked')));
          return req;
        },
        end: vi.fn(),
        write: vi.fn(),
      };
      return req;
    }),
  },
}));

import { _esc, _buildDynamicTemplateHtml } from '../ai-video-pipeline-ai.controller';

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
  { start: 0, duration: 5, eyebrow: 'INTRO', title: '测试标题', subtitle: '副标题内容' },
  { start: 5, duration: 5, eyebrow: 'END', title: '结尾', subtitle: '' },
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

describe('_buildDynamicTemplateHtml — Template C (16:9)', () => {
  const html = () => _buildDynamicTemplateHtml('C', SCENES, '/* gsap */', SPEC_C, 10);

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
    expect(h).toContain('id="sc0"');
    expect(h).toContain('id="sc1"');
  });

  it('renders eyebrow and title for each scene', () => {
    const h = html();
    expect(h).toContain('INTRO');
    expect(h).toContain('测试标题');
    expect(h).toContain('END');
    expect(h).toContain('结尾');
  });

  it('inlines provided GSAP JS', () => {
    expect(html()).toContain('/* gsap */');
  });

  it('includes phone bezel div', () => {
    expect(html()).toContain('id="phone-bezel"');
  });

  it('does NOT include React or Babel CDN scripts', () => {
    const h = html();
    expect(h).not.toContain('react.development.js');
    expect(h).not.toContain('babel.min.js');
  });

  it('escapes HTML in scene content', () => {
    const sceneWithXss = [{ start: 0, duration: 5, eyebrow: '<b>X</b>', title: '&amp;', subtitle: '"q"' }];
    const h = _buildDynamicTemplateHtml('C', sceneWithXss, '', SPEC_C, 5);
    expect(h).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(h).toContain('&amp;amp;');
  });

  it('content panel is right of phone for landscape', () => {
    const h = html();
    // left = phoneRect.x + phoneRect.w + 60 = 206 + 328 + 60 = 594
    expect(h).toContain('left:594px');
  });
});

describe('_buildDynamicTemplateHtml — Template W-G (9:16 portrait)', () => {
  const html = () => _buildDynamicTemplateHtml('W-G', SCENES, '', SPEC_WG, 10);

  it('has correct portrait dimensions', () => {
    const h = html();
    expect(h).toContain('data-width="1080"');
    expect(h).toContain('data-height="1920"');
  });

  it('content panel is below phone for portrait', () => {
    // top = phoneRect.y + phoneRect.h + 48 = 236 + 854 + 48 = 1138
    expect(html()).toContain('top:1138px');
  });

  it('uses portrait (smaller) font size for eyebrow', () => {
    expect(html()).toContain('font-size:13px');
  });
});

describe('_buildDynamicTemplateHtml — no phoneRect', () => {
  it('omits phone-bezel when phoneRect is absent', () => {
    const specNoPhone: TemplateSpec = { ...SPEC_C, phoneRect: undefined };
    const h = _buildDynamicTemplateHtml('C', SCENES, '', specNoPhone, 5);
    expect(h).not.toContain('id="phone-bezel"');
  });
});

describe('_buildDynamicTemplateHtml — GSAP timeline', () => {
  it('includes tl.to({}) hold at full duration', () => {
    const h = _buildDynamicTemplateHtml('C', SCENES, '', SPEC_C, 10);
    expect(h).toMatch(/tl\.to\(\{\}.*D-\.001/s);
  });

  it('includes window.__hf with seek function', () => {
    const h = _buildDynamicTemplateHtml('C', SCENES, '', SPEC_C, 10);
    expect(h).toContain('window.__hf');
    expect(h).toContain('seek:function');
  });

  it('scene with subtitle renders subtitle element', () => {
    const scenes = [{ start: 0, duration: 5, eyebrow: 'KW', title: '主标题', subtitle: '副标题' }];
    const h = _buildDynamicTemplateHtml('C', scenes, '', SPEC_C, 5);
    expect(h).toContain('副标题');
  });
});

// ── Regression #916 ───────────────────────────────────────────────────────────
// composeTemplate was returning { html, aspect } but omitting phoneRect.
// The agent reads phoneRect to know where to overlay the original video on the
// phone screen.  Without it, phoneRect === null and the overlay step is skipped,
// so the output video shows an empty phone frame instead of the real footage.
describe('composeTemplate — phoneRect in response (regression #916)', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('includes phoneRect for template C so agent can overlay original video', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'job-916', template_id: 'C', status: 'pending', license_id: null }],
    });

    const { composeTemplate } = await import('../../controllers/ai-video-pipeline-ai.controller');
    const jsonFn: MockedFunction<Response['json']> = vi.fn();
    const req = {
      params: { id: 'job-916' },
      body: {
        transcript: 'test',
        segments: [{ start: 0, end: 5, text: 'hello world' }],
        duration: 5,
      },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: jsonFn } as unknown as Response;
    const next: NextFunction = vi.fn();

    await composeTemplate(req, res, next);

    expect(jsonFn).toHaveBeenCalledOnce();
    const body = jsonFn.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toHaveProperty('html');
    expect(body).toHaveProperty('aspect', '16:9');
    // phoneRect MUST be present — agent uses it to overlay the original video
    expect(body).toHaveProperty('phoneRect');
    expect(body.phoneRect).toEqual({ x: 206, y: 173, w: 328, h: 724 });
  });
});
