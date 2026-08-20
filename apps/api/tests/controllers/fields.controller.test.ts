import { describe, it, expect } from 'vitest';
import { FieldsController } from '../../src/controllers/fields.controller';

// FieldsController 配套测试(test-pairing 要求)。
// CRUD 行为由 apps/api/tests/fields.test.ts(supertest + mock pool)覆盖;
// 本文件断言 controller 契约:四个处理方法都存在且可实例化。
describe('FieldsController', () => {
  it('暴露 getFields/createField/updateField/deleteField 四个处理方法', () => {
    const c = new FieldsController();
    expect(typeof c.getFields).toBe('function');
    expect(typeof c.createField).toBe('function');
    expect(typeof c.updateField).toBe('function');
    expect(typeof c.deleteField).toBe('function');
  });
});
