import { describe, it, expect } from 'vitest';
import {
  postAgentHeartbeat,
  getAgentStatus,
  postFolderBind,
  postPublishTask,
  getPublishTask,
  listPublishTasks,
  postQrBind,
  getPlatformSessions,
} from './walking-skeleton-1.api';

describe('walking-skeleton-1 api client (export sanity)', () => {
  it('exports the 8 public async functions', () => {
    expect(typeof postAgentHeartbeat).toBe('function');
    expect(typeof getAgentStatus).toBe('function');
    expect(typeof postFolderBind).toBe('function');
    expect(typeof postPublishTask).toBe('function');
    expect(typeof getPublishTask).toBe('function');
    expect(typeof listPublishTasks).toBe('function');
    expect(typeof postQrBind).toBe('function');
    expect(typeof getPlatformSessions).toBe('function');
  });
});
