import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAndValidateSpec, validateSchema, renderHtml } from '../lib.mjs';

test('真实 line02-android.yaml 通过 schema 校验，14 步全部读出', async () => {
  const { spec, errors } = await loadAndValidateSpec();
  assert.deepEqual(errors, []);
  assert.equal(spec.steps.length, 14);
  assert.equal(spec.version, '2.1.19');
});

test('cell 缺 t 和 na 两者都没有 → 校验报错，且报错信息带具体路径', () => {
  const bad = {
    version: '1.0.0',
    environment: 'x',
    steps: [
      {
        n: 1,
        name: '步骤1',
        op: '做点什么',
        cells: {
          c1: {}, // 缺 t 和 na
          c2: { na: true },
          c3: { na: true },
          c4: { na: true },
        },
      },
    ],
  };
  const { errors } = validateSchema(bad);
  assert.ok(errors.length > 0, '应该报错');
  assert.ok(
    errors.some(e => e.includes('c1')),
    `报错信息应指出具体是哪个格子缺字段，实际: ${JSON.stringify(errors)}`
  );
});

test('cell 有 t 但缺 verifiable_by → 校验报错', () => {
  const bad = {
    version: '1.0.0',
    environment: 'x',
    steps: [
      {
        n: 1,
        name: '步骤1',
        op: '做点什么',
        cells: {
          c1: { t: '判据文字，但没写谁能验' }, // 缺 verifiable_by
          c2: { na: true },
          c3: { na: true },
          c4: { na: true },
        },
      },
    ],
  };
  const { errors } = validateSchema(bad);
  assert.ok(errors.length > 0, '应该报错');
});

test('verifiable_by 值不在三值枚举里 → 校验报错', () => {
  const bad = {
    version: '1.0.0',
    environment: 'x',
    steps: [
      {
        n: 1,
        name: '步骤1',
        op: '做点什么',
        cells: {
          c1: { t: '判据', verifiable_by: 'ai_magic' }, // 非法枚举值
          c2: { na: true },
          c3: { na: true },
          c4: { na: true },
        },
      },
    ],
  };
  const { errors } = validateSchema(bad);
  assert.ok(errors.length > 0, '应该报错');
});

test('renderHtml 生成的页面包含14步内容、无英文残留、判定按钮完整渲染', async () => {
  const { spec, errors } = await loadAndValidateSpec();
  assert.deepEqual(errors, []);
  const html = renderHtml(spec);

  // 14 步内容都在
  for (const st of spec.steps) {
    assert.ok(html.includes(st.name), `缺步骤名：${st.name}`);
  }

  // 无英文单词残留（排除 script/style 标签内容）
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const englishWords = stripped.match(/[A-Za-z]{2,}/g) || [];
  assert.deepEqual(englishWords, [], `可见文本含英文残留: ${JSON.stringify(englishWords)}`);

  // 判定按钮数量：每个非固定不适用的格子（na!==true）应有一组 tri 按钮
  const judgedCellCount = spec.steps.reduce((sum, st) => {
    return sum + ['c1', 'c2', 'c3', 'c4'].filter(ck => !(st.cells[ck].na === true)).length;
  }, 0);
  const triCount = (html.match(/class="tri"/g) || []).length;
  assert.equal(triCount, judgedCellCount, '判定按钮组数应等于非不适用的格子数');
});
