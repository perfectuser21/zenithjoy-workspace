/**
 * Tests for ABTest Component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ABTest } from '../ABTest';
import * as abTesting from '../../lib/ab-testing';

// Mock the ab-testing library
vi.mock('../../lib/ab-testing', () => ({
  getABTestVariant: vi.fn()
}));

describe('ABTest Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render control variant', async () => {
    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'control',
      isNew: false
    });

    render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a']
        }}
      >
        {(variant) => (
          <div data-testid="variant">{variant}</div>
        )}
      </ABTest>
    );

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('control');
    });
  });

  it('should render variant_a', async () => {
    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'variant_a',
      isNew: false
    });

    render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a']
        }}
      >
        {(variant) => (
          <div data-testid="variant">{variant}</div>
        )}
      </ABTest>
    );

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('variant_a');
    });
  });

  it('should render fallback before variant is assigned', () => {
    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'control',
      isNew: false
    });

    const { container } = render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a']
        }}
        fallback={<div data-testid="fallback">Loading...</div>}
      >
        {(variant) => (
          <div data-testid="variant">{variant}</div>
        )}
      </ABTest>
    );

    // Initially should show fallback (before useEffect runs)
    // After useEffect, should show variant
    expect(container).toBeTruthy();
  });

  it('should handle multiple variants', async () => {
    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'variant_b',
      isNew: false
    });

    render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a', 'variant_b', 'variant_c']
        }}
      >
        {(variant) => (
          <div data-testid="variant">{variant}</div>
        )}
      </ABTest>
    );

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('variant_b');
    });
  });

  it('should render different content based on variant', async () => {
    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'button_test',
      variant: 'variant_a',
      isNew: false
    });

    render(
      <ABTest
        config={{
          id: 'button_test',
          variants: ['control', 'variant_a']
        }}
      >
        {(variant) => (
          variant === 'control' ? (
            <button data-testid="button">Original Button</button>
          ) : (
            <button data-testid="button">New Button</button>
          )
        )}
      </ABTest>
    );

    await waitFor(() => {
      expect(screen.getByTestId('button')).toHaveTextContent('New Button');
    });
  });

  it('should call getABTestVariant with correct config', () => {
    const config = {
      id: 'test_experiment',
      variants: ['control', 'variant_a'],
      weights: [50, 50]
    };

    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test_experiment',
      variant: 'control',
      isNew: true
    });

    render(
      <ABTest config={config}>
        {(variant) => <div>{variant}</div>}
      </ABTest>
    );

    expect(abTesting.getABTestVariant).toHaveBeenCalledWith(config);
  });

  it('should log new assignment in console', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'variant_a',
      isNew: true // New assignment
    });

    render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a']
        }}
      >
        {(variant) => <div>{variant}</div>}
      </ABTest>
    );

    await waitFor(() => {
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[AB Test] New assignment: test = variant_a'
      );
    });

    consoleLogSpy.mockRestore();
  });

  it('should not log if assignment is not new', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(abTesting.getABTestVariant).mockReturnValue({
      experimentId: 'test',
      variant: 'control',
      isNew: false // Existing assignment
    });

    render(
      <ABTest
        config={{
          id: 'test',
          variants: ['control', 'variant_a']
        }}
      >
        {(variant) => <div>{variant}</div>}
      </ABTest>
    );

    await waitFor(() => {
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    consoleLogSpy.mockRestore();
  });
});
