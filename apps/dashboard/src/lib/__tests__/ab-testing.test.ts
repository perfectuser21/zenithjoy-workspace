/**
 * Tests for A/B Testing Framework
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getABTestVariant,
  trackABTestConversion,
  resetABTest,
  getActiveExperiments,
  type ABTestConfig
} from '../ab-testing';

// Mock document.cookie
let cookieStore: Record<string, string> = {};

beforeEach(() => {
  // Reset cookie store
  cookieStore = {};

  // Mock document.cookie
  Object.defineProperty(document, 'cookie', {
    get: () => {
      return Object.entries(cookieStore)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    },
    set: (value: string) => {
      const [keyValue] = value.split(';');
      const [key, val] = keyValue.split('=');
      if (val) {
        cookieStore[key.trim()] = val.trim();
      } else {
        // Delete cookie if no value (max-age=0)
        delete cookieStore[key.trim()];
      }
    },
    configurable: true
  });

  // Mock window.clarity
  (window as any).clarity = vi.fn();
});

describe('A/B Testing Framework', () => {
  describe('getABTestVariant', () => {
    it('should assign a variant on first visit', () => {
      const config: ABTestConfig = {
        id: 'test_experiment',
        variants: ['control', 'variant_a']
      };

      const result = getABTestVariant(config);

      expect(result.experimentId).toBe('test_experiment');
      expect(['control', 'variant_a']).toContain(result.variant);
      expect(result.isNew).toBe(true);
    });

    it('should return the same variant on subsequent visits', () => {
      const config: ABTestConfig = {
        id: 'test_experiment',
        variants: ['control', 'variant_a']
      };

      const firstResult = getABTestVariant(config);
      const secondResult = getABTestVariant(config);

      expect(secondResult.variant).toBe(firstResult.variant);
      expect(secondResult.isNew).toBe(false);
    });

    it('should handle multiple concurrent experiments', () => {
      const config1: ABTestConfig = {
        id: 'experiment_1',
        variants: ['control', 'variant_a']
      };

      const config2: ABTestConfig = {
        id: 'experiment_2',
        variants: ['control', 'variant_b']
      };

      const result1 = getABTestVariant(config1);
      const result2 = getABTestVariant(config2);

      expect(result1.experimentId).toBe('experiment_1');
      expect(result2.experimentId).toBe('experiment_2');

      // Both experiments should have variants assigned
      expect(['control', 'variant_a']).toContain(result1.variant);
      expect(['control', 'variant_b']).toContain(result2.variant);
    });

    it('should support 3+ variants', () => {
      const config: ABTestConfig = {
        id: 'multi_variant',
        variants: ['control', 'variant_a', 'variant_b', 'variant_c']
      };

      const result = getABTestVariant(config);

      expect(['control', 'variant_a', 'variant_b', 'variant_c']).toContain(
        result.variant
      );
    });

    it('should track experiment assignment with Clarity', () => {
      const config: ABTestConfig = {
        id: 'test_experiment',
        variants: ['control', 'variant_a']
      };

      getABTestVariant(config);

      expect(window.clarity).toHaveBeenCalledWith(
        'set',
        'experiment_test_experiment',
        expect.any(String)
      );
    });
  });

  describe('trackABTestConversion', () => {
    it('should track conversion with Clarity', () => {
      // Setup: Assign a variant first
      const config: ABTestConfig = {
        id: 'test_experiment',
        variants: ['control', 'variant_a']
      };
      const { variant } = getABTestVariant(config);

      // Reset mock to clear assignment call
      vi.clearAllMocks();

      // Track conversion
      trackABTestConversion('test_experiment', 'signup_click');

      expect(window.clarity).toHaveBeenCalledWith(
        'event',
        `signup_click_${variant}`
      );
    });

    it('should warn if no variant is assigned', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      trackABTestConversion('non_existent', 'click');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AB Test] No variant found for experiment: non_existent'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('resetABTest', () => {
    it('should remove experiment cookie', () => {
      const config: ABTestConfig = {
        id: 'test_experiment',
        variants: ['control', 'variant_a']
      };

      // Assign variant
      const firstResult = getABTestVariant(config);
      expect(firstResult.isNew).toBe(true);

      // Reset experiment
      resetABTest('test_experiment');

      // Next assignment should be new
      const secondResult = getABTestVariant(config);
      expect(secondResult.isNew).toBe(true);
    });
  });

  describe('getActiveExperiments', () => {
    it('should return all active experiments', () => {
      const config1: ABTestConfig = {
        id: 'experiment_1',
        variants: ['control', 'variant_a']
      };

      const config2: ABTestConfig = {
        id: 'experiment_2',
        variants: ['control', 'variant_b']
      };

      getABTestVariant(config1);
      getABTestVariant(config2);

      const activeExperiments = getActiveExperiments();

      expect(Object.keys(activeExperiments)).toHaveLength(2);
      expect(activeExperiments).toHaveProperty('experiment_1');
      expect(activeExperiments).toHaveProperty('experiment_2');
    });

    it('should return empty object if no experiments', () => {
      const activeExperiments = getActiveExperiments();
      expect(activeExperiments).toEqual({});
    });
  });

  describe('Variant distribution', () => {
    it('should distribute variants roughly evenly over many trials', () => {
      const config: ABTestConfig = {
        id: 'distribution_test',
        variants: ['control', 'variant_a']
      };

      const trials = 1000;
      const counts: Record<string, number> = {
        control: 0,
        variant_a: 0
      };

      for (let i = 0; i < trials; i++) {
        // Reset experiment for each trial
        resetABTest('distribution_test');

        const { variant } = getABTestVariant(config);
        counts[variant]++;
      }

      // Check that distribution is roughly 50/50 (within 10% margin)
      const controlRatio = counts.control / trials;
      const variantRatio = counts.variant_a / trials;

      expect(controlRatio).toBeGreaterThan(0.4);
      expect(controlRatio).toBeLessThan(0.6);
      expect(variantRatio).toBeGreaterThan(0.4);
      expect(variantRatio).toBeLessThan(0.6);
    });
  });
});
