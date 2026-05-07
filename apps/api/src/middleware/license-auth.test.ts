import { describe, it, expect } from 'vitest';
import { licenseAuth } from './license-auth';

describe('license-auth (export sanity)', () => {
  it('exports licenseAuth as a function', () => {
    expect(typeof licenseAuth).toBe('function');
  });
});
