import { describe, it, expect } from 'vitest';
import router from './video-remake';

describe('video-remake router (export sanity)', () => {
  it('exports a Router instance', () => {
    // Express Router has a stack property listing registered routes
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });

  it('has the raw-video route registered', () => {
    // Check router stack includes the /raw-video path
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const rawVideoRoute = stack.find((layer) => layer.route?.path === '/jobs/:job_id/raw-video');
    expect(rawVideoRoute).toBeDefined();
  });

  it('has all 6 required routes registered', () => {
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const paths = stack.filter((l) => l.route).map((l) => l.route?.path ?? '');
    expect(paths).toContain('/jobs');
    expect(paths).toContain('/jobs/:job_id');
    expect(paths).toContain('/jobs/:job_id/nodes/N06/continue');
    expect(paths).toContain('/jobs/:job_id/nodes/N07/select');
    expect(paths).toContain('/jobs/:job_id/output');
    expect(paths).toContain('/jobs/:job_id/raw-video');
  });
});
