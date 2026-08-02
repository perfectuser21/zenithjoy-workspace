import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['acquisition-config-effective-validation.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
