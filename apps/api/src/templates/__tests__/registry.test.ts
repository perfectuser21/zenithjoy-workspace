import { describe, it, expect } from 'vitest';
import { getTemplate, readTemplateJsx } from '../registry';

describe('template registry', () => {
  it('returns W-G spec', () => {
    const spec = getTemplate('W-G');
    expect(spec).toBeTruthy();
    expect(spec!.aspect).toBe('9:16');
    expect(spec!.width).toBe(1080);
    expect(spec!.height).toBe(1920);
  });

  it('returns null for unknown id', () => {
    expect(getTemplate('UNKNOWN')).toBeNull();
  });

  it('reads W-G JSX file', () => {
    const spec = getTemplate('W-G')!;
    const src = readTemplateJsx(spec);
    expect(src).toContain('SlideWG');
    expect(src).toContain('window.TemplateRegistry');
  });
});
