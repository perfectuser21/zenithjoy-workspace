/**
 * A/B Testing Framework
 *
 * Cookie-based variant assignment for consistent user experience
 * Supports multiple concurrent experiments
 */

export interface ABTestConfig {
  id: string;
  variants: string[];
  weights?: number[]; // Optional weights for each variant (default: equal distribution)
}

export interface ABTestResult {
  experimentId: string;
  variant: string;
  isNew: boolean; // Whether this is the first time the user is seeing this experiment
}

const COOKIE_PREFIX = 'ab_test_';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Get or set cookie value
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);

  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }

  return null;
}

function setCookie(name: string, value: string, maxAge: number = COOKIE_MAX_AGE): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Assign a variant based on weights
 */
function assignVariant(variants: string[], weights?: number[]): string {
  if (!weights || weights.length !== variants.length) {
    // Equal distribution
    const index = Math.floor(Math.random() * variants.length);
    return variants[index];
  }

  // Weighted distribution
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const random = Math.random() * totalWeight;

  let cumulative = 0;
  for (let i = 0; i < variants.length; i++) {
    cumulative += weights[i];
    if (random < cumulative) {
      return variants[i];
    }
  }

  return variants[variants.length - 1];
}

/**
 * Get variant for an A/B test experiment
 *
 * @param config - Experiment configuration
 * @returns Variant name and whether it's a new assignment
 *
 * @example
 * ```tsx
 * const { variant } = getABTestVariant({
 *   id: 'hero_headline',
 *   variants: ['control', 'variant_a', 'variant_b']
 * });
 * ```
 */
export function getABTestVariant(config: ABTestConfig): ABTestResult {
  const cookieName = `${COOKIE_PREFIX}${config.id}`;
  const existingVariant = getCookie(cookieName);

  if (existingVariant && config.variants.includes(existingVariant)) {
    return {
      experimentId: config.id,
      variant: existingVariant,
      isNew: false
    };
  }

  // Assign new variant
  const variant = assignVariant(config.variants, config.weights);
  setCookie(cookieName, variant);

  // Track assignment (if analytics is available)
  if (typeof window !== 'undefined' && (window as any).clarity) {
    (window as any).clarity('set', `experiment_${config.id}`, variant);
  }

  return {
    experimentId: config.id,
    variant,
    isNew: true
  };
}

/**
 * Track conversion event for an experiment
 *
 * @param experimentId - Experiment ID
 * @param eventName - Conversion event name
 *
 * @example
 * ```tsx
 * trackABTestConversion('hero_headline', 'signup_click');
 * ```
 */
export function trackABTestConversion(experimentId: string, eventName: string): void {
  const cookieName = `${COOKIE_PREFIX}${experimentId}`;
  const variant = getCookie(cookieName);

  if (!variant) {
    console.warn(`[AB Test] No variant found for experiment: ${experimentId}`);
    return;
  }

  // Track with analytics
  if (typeof window !== 'undefined') {
    // Microsoft Clarity
    if ((window as any).clarity) {
      (window as any).clarity('event', `${eventName}_${variant}`);
    }

    // Google Analytics (if available)
    if ((window as any).gtag) {
      (window as any).gtag('event', eventName, {
        experiment_id: experimentId,
        variant: variant
      });
    }
  }

  console.log(`[AB Test] Conversion tracked: ${experimentId} / ${variant} / ${eventName}`);
}

/**
 * Reset an experiment (for testing purposes)
 */
export function resetABTest(experimentId: string): void {
  const cookieName = `${COOKIE_PREFIX}${experimentId}`;
  if (typeof document !== 'undefined') {
    document.cookie = `${cookieName}=; path=/; max-age=0`;
  }
}

/**
 * Get all active experiments for the current user
 */
export function getActiveExperiments(): Record<string, string> {
  if (typeof document === 'undefined') return {};

  const experiments: Record<string, string> = {};
  const cookies = document.cookie.split(';');

  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name.startsWith(COOKIE_PREFIX)) {
      const experimentId = name.replace(COOKIE_PREFIX, '');
      experiments[experimentId] = value;
    }
  }

  return experiments;
}
