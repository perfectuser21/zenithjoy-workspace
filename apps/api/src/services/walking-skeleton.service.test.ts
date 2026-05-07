import { describe, it, expect } from 'vitest';
import {
  validateLicense,
  upsertAgentByHeartbeat,
  bindFolder,
  createPublishTask,
  submitPublishReceipt,
  getPublishTask,
  getQueuedTasks,
  findAgentById,
} from './walking-skeleton.service';

describe('walking-skeleton service (export sanity)', () => {
  it('exports the 8 required public async functions', () => {
    expect(typeof validateLicense).toBe('function');
    expect(typeof upsertAgentByHeartbeat).toBe('function');
    expect(typeof bindFolder).toBe('function');
    expect(typeof createPublishTask).toBe('function');
    expect(typeof submitPublishReceipt).toBe('function');
    expect(typeof getPublishTask).toBe('function');
    expect(typeof getQueuedTasks).toBe('function');
    expect(typeof findAgentById).toBe('function');
  });
});
