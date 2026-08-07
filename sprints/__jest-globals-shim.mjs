/**
 * @jest/globals shim for vitest
 * vitest 以 globals:true 运行时，describe/test/expect/vi 均已注入全局作用域。
 * 这个 shim 允许测试文件用 `import { jest } from '@jest/globals'` 而不报错。
 */
// eslint-disable-next-line no-undef
export const jest = typeof vi !== 'undefined' ? vi : undefined;
// eslint-disable-next-line no-undef
export { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, it };
