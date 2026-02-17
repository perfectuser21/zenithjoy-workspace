import { useEffect, useState, ReactNode } from 'react';
import { getABTestVariant, type ABTestConfig } from '../lib/ab-testing';

interface ABTestProps {
  config: ABTestConfig;
  children: (variant: string) => ReactNode;
  fallback?: ReactNode;
}

/**
 * ABTest Component
 *
 * Renders different content based on assigned A/B test variant
 *
 * @example
 * ```tsx
 * <ABTest
 *   config={{
 *     id: 'hero_headline',
 *     variants: ['control', 'variant_a']
 *   }}
 * >
 *   {(variant) => (
 *     variant === 'control' ? (
 *       <h1>Original Headline</h1>
 *     ) : (
 *       <h1>New Headline</h1>
 *     )
 *   )}
 * </ABTest>
 * ```
 */
export function ABTest({ config, children, fallback = null }: ABTestProps) {
  const [variant, setVariant] = useState<string | null>(null);

  useEffect(() => {
    const result = getABTestVariant(config);
    setVariant(result.variant);

    // Log new assignment for debugging
    if (result.isNew) {
      console.log(`[AB Test] New assignment: ${config.id} = ${result.variant}`);
    }
  }, [config]); // Re-run if config changes

  if (!variant) {
    return <>{fallback}</>;
  }

  return <>{children(variant)}</>;
}
