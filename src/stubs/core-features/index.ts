/**
 * Stub for @features/core when zenithjoy-core is not available
 * This allows the build to succeed in CI and other environments without Core
 */

export async function buildCoreConfig() {
  console.warn('Core features not available - using stub');
  return null;
}

export const coreFeatures = {};
export const coreInstanceConfig = null;
export const coreTheme = null;
