import { describe, it, expect } from 'vitest';
import * as controller from './clips.controller';

describe('clips.controller (export sanity)', () => {
  it('exports all required handler functions', () => {
    expect(typeof controller.submitClip).toBe('function');
    expect(typeof controller.listClips).toBe('function');
    expect(typeof controller.getClipDetail).toBe('function');
    expect(typeof controller.retryClip).toBe('function');
    expect(typeof controller.handleCallback).toBe('function');
    expect(typeof controller.getUserSettings).toBe('function');
    expect(typeof controller.saveUserSettings).toBe('function');
  });
});
