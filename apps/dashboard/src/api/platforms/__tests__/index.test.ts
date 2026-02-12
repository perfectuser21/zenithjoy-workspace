/**
 * Platform Registry Tests
 */

import { describe, it, expect } from 'vitest';
import { getPlatform, getAllPlatforms, getPlatformIds } from '../index';

describe('Platform Registry', () => {
  describe('getPlatform', () => {
    it('should return ToAPI platform', () => {
      const platform = getPlatform('toapi');
      expect(platform.id).toBe('toapi');
      expect(platform.name).toBe('ToAPI');
    });

    it('should throw error for unknown platform', () => {
      expect(() => getPlatform('unknown')).toThrow('Platform unknown not found');
    });
  });

  describe('getAllPlatforms', () => {
    it('should return all registered platforms', () => {
      const platforms = getAllPlatforms();
      expect(platforms).toHaveLength(1);
      expect(platforms[0].id).toBe('toapi');
    });
  });

  describe('getPlatformIds', () => {
    it('should return all platform IDs', () => {
      const ids = getPlatformIds();
      expect(ids).toContain('toapi');
    });
  });
});
