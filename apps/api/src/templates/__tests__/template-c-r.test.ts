import fs from 'fs';
import { describe, it, expect } from 'vitest';
import { getTemplate, readTemplateJsx } from '../registry';

describe('template C — 克制纪录片 16:9', () => {
  it('getTemplate returns C spec', () => {
    const spec = getTemplate('C');
    expect(spec).not.toBeNull();
    expect(spec!.aspect).toBe('16:9');
    expect(spec!.width).toBe(1920);
    expect(spec!.height).toBe(1080);
    expect(spec!.component).toBe('SlideC');
  });

  it('template-c.jsx file exists', () => {
    const spec = getTemplate('C')!;
    expect(fs.existsSync(spec.jsxFile)).toBe(true);
  });

  it('readTemplateJsx returns JSX containing SlideC', () => {
    const jsx = readTemplateJsx(getTemplate('C')!);
    expect(jsx).toContain('SlideC');
    expect(jsx).toContain('slots');
    expect(jsx).toContain('data-gsap');
  });
});

describe('template R — 深酒红棕徽章式 16:9', () => {
  it('getTemplate returns R spec', () => {
    const spec = getTemplate('R');
    expect(spec).not.toBeNull();
    expect(spec!.aspect).toBe('16:9');
    expect(spec!.width).toBe(1920);
    expect(spec!.height).toBe(1080);
    expect(spec!.component).toBe('SlideR');
  });

  it('template-r.jsx file exists', () => {
    const spec = getTemplate('R')!;
    expect(fs.existsSync(spec.jsxFile)).toBe(true);
  });

  it('readTemplateJsx returns JSX containing SlideR', () => {
    const jsx = readTemplateJsx(getTemplate('R')!);
    expect(jsx).toContain('SlideR');
    expect(jsx).toContain('slots');
    expect(jsx).toContain('data-gsap');
  });
});
