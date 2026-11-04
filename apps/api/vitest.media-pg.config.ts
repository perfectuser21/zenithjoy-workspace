import { defineConfig } from 'vitest/config';
export default defineConfig({test:{globals:true,setupFiles:['tests/setup-http.ts'],include:['tests/integration/media/*.test.ts'],fileParallelism:false,testTimeout:15000}});
