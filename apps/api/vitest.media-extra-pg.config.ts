import {defineConfig} from 'vitest/config';
export default defineConfig({resolve:{extensions:['.ts','.tsx','.mts','.cts','.mjs','.js','.jsx','.json']},test:{globals:true,setupFiles:['tests/setup-http.ts'],include:['tests/integration/media-extra/*.test.ts'],fileParallelism:false,testTimeout:15000}});
