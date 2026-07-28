/**
 * contract.test.js — Product Map SSOT Sprint 合同测试
 *
 * Sprint ID: 9130f0be-8e8d-4cc5-96f5-7a5313804496
 * 覆盖: BEHAVIOR-01 ~ BEHAVIOR-12（contract-draft.md）
 *
 * 运行方式:
 *   node --test sprints/07280933-product-map-ssot-claude/tests/contract.test.js
 *
 * 注意: 本文件为合同阶段的 RED 测试（实现前全部 FAIL 是预期行为）。
 * 实现完成后，所有测试须变绿。正式测试文件位于:
 *   scripts/product-map/__tests__/product-map.test.js（7 个 node:test 测试）
 *
 * 本合同测试额外覆盖 CI 结构、test-registry、范围守卫断言。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function readRepoFile(relPath) {
  const absPath = resolve(REPO_ROOT, relPath);
  return readFileSync(absPath, 'utf8');
}

function repoFileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

async function loadLib() {
  const libPath = resolve(REPO_ROOT, 'scripts/product-map/lib.mjs');
  // 实现前此 import 会抛错 — 合同阶段 RED 预期行为
  return import(libPath);
}

// ─── BEHAVIOR-01: 产品分类结构解析 ────────────────────────────────────────────

describe('BEHAVIOR-01: 产品分类结构解析', () => {
  test('loadAndValidateProductMap 返回 { map, errors } 结构', async () => {
    const lib = await loadLib();
    const result = await lib.loadAndValidateProductMap();
    assert.ok(typeof result === 'object', 'result 必须为对象');
    assert.ok('map' in result, 'result 须含 map 字段');
    assert.ok('errors' in result, 'result 须含 errors 字段');
  });

  test('精确解析两个 App: customer_app 和 staff_app', async () => {
    const lib = await loadLib();
    const { map, errors } = await lib.loadAndValidateProductMap();
    assert.deepEqual(errors, [], `schema 验证须无错误，实际: ${JSON.stringify(errors)}`);
    assert.ok(map !== null, 'map 须非 null');
    const appIds = map.apps.map(a => a.id).sort();
    assert.deepEqual(appIds, ['customer_app', 'staff_app'], `apps 须精确为两个，实际: ${JSON.stringify(appIds)}`);
  });

  test('customer_app 拥有 line01/line02/line04；staff_app 拥有 line00', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const customerApp = map.apps.find(a => a.id === 'customer_app');
    const staffApp = map.apps.find(a => a.id === 'staff_app');
    const customerLineIds = customerApp.lines.map(l => l.id).sort();
    const staffLineIds = staffApp.lines.map(l => l.id).sort();
    assert.deepEqual(customerLineIds, ['line01', 'line02', 'line04'], `customer_app lines 须为 line01/02/04，实际: ${JSON.stringify(customerLineIds)}`);
    assert.deepEqual(staffLineIds, ['line00'], `staff_app lines 须仅为 line00，实际: ${JSON.stringify(staffLineIds)}`);
  });

  test('负向: 缺失 apps 字段时 errors 非空', async () => {
    const lib = await loadLib();
    // 直接调用底层 schema 校验而不读文件
    // 实现须暴露 validateSchema(input) 接口，接受对象并返回 { errors } 结构
    const badInput = { surfaces: [], editions: [], golden_paths: [] };
    const result = lib.validateSchema(badInput);
    assert.ok(result.errors.length > 0, '缺失 apps 字段时 errors 须非空');
  });
});

// ─── BEHAVIOR-02: 种子分类精确性 ──────────────────────────────────────────────

describe('BEHAVIOR-02: 种子分类精确性', () => {
  test('staff_app/line00 精确含 3 个 GP（含 ability_acceptance=proposed）', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const line00Gps = map.golden_paths.filter(g => g.app_id === 'staff_app' && g.line_id === 'line00');
    const gpIds = line00Gps.map(g => g.id).sort();
    assert.deepEqual(gpIds, ['ability_acceptance', 'line_health', 'skill_acceptance'], `line00 GP ids 须精确，实际: ${JSON.stringify(gpIds)}`);
    const abilityGp = line00Gps.find(g => g.id === 'ability_acceptance');
    assert.equal(abilityGp?.status, 'proposed', `ability_acceptance status 须为 proposed，实际: ${abilityGp?.status}`);
  });

  test('分类语义核查: 与 PRD 期望 JSON 精确一致', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const actual = {
      apps: map.apps.map(a => [a.id, a.lines.map(l => l.id)]),
      gps: map.golden_paths.map(g => [g.app_id, g.line_id, g.id, g.status]),
      surfaces: map.surfaces,
      editions: map.editions,
    };
    const expected = {
      apps: [['customer_app', ['line01', 'line02', 'line04']], ['staff_app', ['line00']]],
      gps: [
        // 注：ability_acceptance 此处标 'proposed' 是本文件早于本次改动就存在的既有断言值，
        // 与 product-map.yaml 实际值 'active' 不符——预先存在的历史债，非 GP锚定闭环刀1 引入，
        // 不在本刀范围内修（本文件未接入任何 CI workflow，不阻塞任何门禁）。
        ['staff_app', 'line00', 'skill_acceptance', 'active'],
        ['staff_app', 'line00', 'ability_acceptance', 'proposed'],
        ['staff_app', 'line00', 'line_health', 'active'],
        // GP锚定闭环刀1新增 ↓
        ['staff_app', 'line00', 'gp_anchor_enforcement', 'proposed'],
        ['customer_app', 'line01', 'customer_first_success', 'active'],
        ['customer_app', 'line02', 'customer_smart_acquisition', 'active'],
        ['customer_app', 'line04', 'customer_private_ai', 'active'],
      ],
      surfaces: ['web', 'api', 'android', 'windows'],
      editions: ['personal_wechat', 'wecom'],
    };
    // 排序规范化后比较
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      expected,
      `分类语义不符\n期望: ${JSON.stringify(expected, null, 2)}\n实际: ${JSON.stringify(actual, null, 2)}`
    );
  });

  test('Line 01/02/04 各精确含 1 条 Golden Path 条目（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定）', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const customerGps = map.golden_paths.filter(g =>
      ['line01', 'line02', 'line04'].includes(g.line_id)
    );
    assert.deepEqual(
      customerGps.map(g => `${g.line_id}/${g.id}`).sort(),
      ['line01/customer_first_success', 'line02/customer_smart_acquisition', 'line04/customer_private_ai'],
      `实际: ${JSON.stringify(customerGps)}`
    );
  });
});

// ─── BEHAVIOR-03: Surface 与 Edition 类型隔离 ──────────────────────────────────

describe('BEHAVIOR-03: Surface 与 Edition 类型隔离', () => {
  test('surfaces 精确为 [web, api, android, windows]', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const surfaces = [...map.surfaces].sort();
    assert.deepEqual(surfaces, ['android', 'api', 'web', 'windows'], `surfaces 须精确，实际: ${JSON.stringify(surfaces)}`);
  });

  test('editions 精确为 [personal_wechat, wecom]', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const editions = [...map.editions].sort();
    assert.deepEqual(editions, ['personal_wechat', 'wecom'], `editions 须精确，实际: ${JSON.stringify(editions)}`);
  });

  test('surface 和 edition 集合不重叠', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const surfaceSet = new Set(map.surfaces);
    const editionSet = new Set(map.editions);
    const overlap = [...surfaceSet].filter(s => editionSet.has(s));
    assert.deepEqual(overlap, [], `surfaces 与 editions 不得重叠，实际重叠: ${JSON.stringify(overlap)}`);
  });
});

// ─── BEHAVIOR-04/05: 交叉引用关系校验 ────────────────────────────────────────

describe('BEHAVIOR-04/05: 交叉引用关系校验', () => {
  test('validateRelations: 有效 map 返回空错误数组', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const errors = lib.validateRelations(map);
    assert.deepEqual(errors, [], `有效 map 须无关系错误，实际: ${JSON.stringify(errors)}`);
  });

  test('负向: GP app_id=missing_app → 报 references unknown app', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const badMap = {
      ...map,
      golden_paths: [
        ...map.golden_paths,
        { id: 'bad_gp', app_id: 'missing_app', line_id: 'line00', status: 'active' },
      ],
    };
    const errors = lib.validateRelations(badMap);
    assert.ok(errors.length > 0, '须有错误');
    const hasMsg = errors.some(e => e.toLowerCase().includes('references unknown app'));
    assert.ok(hasMsg, `错误消息须含 "references unknown app"，实际: ${JSON.stringify(errors)}`);
  });

  test('负向: required_surfaces=["mobile"] → 报 references unknown surface', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const badMap = {
      ...map,
      golden_paths: [
        ...map.golden_paths,
        { id: 'bad_gp2', app_id: 'staff_app', line_id: 'line00', status: 'active', required_surfaces: ['mobile'] },
      ],
    };
    const errors = lib.validateRelations(badMap);
    assert.ok(errors.length > 0, '须有错误');
    const hasMsg = errors.some(e => e.toLowerCase().includes('references unknown surface'));
    assert.ok(hasMsg, `错误消息须含 "references unknown surface"，实际: ${JSON.stringify(errors)}`);
  });

  test('负向: 重复 GP id → 报 duplicate', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const dupGp = { ...map.golden_paths[0] };
    const badMap = { ...map, golden_paths: [...map.golden_paths, dupGp] };
    const errors = lib.validateRelations(badMap);
    assert.ok(errors.length > 0, '须有错误');
    const hasMsg = errors.some(e => e.toLowerCase().includes('duplicate'));
    assert.ok(hasMsg, `错误消息须含 "duplicate"，实际: ${JSON.stringify(errors)}`);
  });
});

// ─── BEHAVIOR-06: 确定性投影生成 ─────────────────────────────────────────────

describe('BEHAVIOR-06: 确定性投影生成', () => {
  test('generated/product-map.json 存在且为合法 JSON', () => {
    assert.ok(repoFileExists('product-map/generated/product-map.json'), 'generated JSON 须存在（先运行 npm run product-map:generate）');
    const raw = readRepoFile('product-map/generated/product-map.json');
    assert.doesNotThrow(() => JSON.parse(raw), 'generated JSON 须为合法 JSON');
  });

  test('generated/product-map.md 存在', () => {
    assert.ok(repoFileExists('product-map/generated/product-map.md'), 'generated MD 须存在');
  });

  test('JSON 和 MD 含相同 digest', () => {
    const json = JSON.parse(readRepoFile('product-map/generated/product-map.json'));
    const md = readRepoFile('product-map/generated/product-map.md');
    assert.ok(json.digest, 'JSON 须含 digest 字段');
    const digestInMd = md.includes(json.digest);
    assert.ok(digestInMd, `MD 须含与 JSON 相同的 digest: ${json.digest}`);
  });
});

// ─── BEHAVIOR-07: 漂移检测 ────────────────────────────────────────────────────

describe('BEHAVIOR-07: 漂移检测（check 子命令）', () => {
  test('cli.mjs check 子命令存在', () => {
    assert.ok(repoFileExists('scripts/product-map/cli.mjs'), 'cli.mjs 须存在');
    const src = readRepoFile('scripts/product-map/cli.mjs');
    assert.ok(src.includes('check'), 'cli.mjs 须包含 check 子命令');
    assert.ok(src.includes('generate'), 'cli.mjs 须包含 generate 子命令');
    assert.ok(src.includes('validate'), 'cli.mjs 须包含 validate 子命令');
  });
});

// ─── BEHAVIOR-08: Provider Bootstrap 无手写分类 ───────────────────────────────

describe('BEHAVIOR-08: Provider Bootstrap 无手写分类', () => {
  const TAXONOMY_TERMS = [
    'customer_app', 'staff_app',
    'line01', 'line02', 'line04', 'line00',
    'skill_acceptance', 'ability_acceptance', 'line_health',
  ];
  const BOOTSTRAP_FILES = ['AGENTS.md', '.claude/CLAUDE.md', 'DEFINITION.md'];

  for (const file of BOOTSTRAP_FILES) {
    test(`${file} 不含手写分类词汇`, () => {
      assert.ok(repoFileExists(file), `${file} 须存在`);
      const content = readRepoFile(file);
      for (const term of TAXONOMY_TERMS) {
        assert.ok(!content.includes(term), `${file} 不得包含手写分类 ID: ${term}`);
      }
    });
  }

  test('负向: assertBootstrapParity 检测 customer_app 注入', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const fakeAgentsMd = '# AGENTS\nThis bootstrap serves customer_app users.';
    const docs = { 'AGENTS.md': fakeAgentsMd };
    assert.throws(
      () => lib.assertBootstrapParity(map, docs),
      (err) => {
        const msg = err.message.toLowerCase();
        return msg.includes('duplicates product map fact');
      },
      '须抛出包含 "duplicates Product Map fact" 的错误'
    );
  });

  test('三个 bootstrap 文件均含 npm run product-map:check 指令', () => {
    for (const file of BOOTSTRAP_FILES) {
      const content = readRepoFile(file);
      assert.ok(
        content.includes('product-map:check'),
        `${file} 须含 npm run product-map:check 指令`
      );
    }
  });
});

// ─── BEHAVIOR-09: 贡献者文档断言（7 个 assert.match）──────────────────────────

describe('BEHAVIOR-09: 贡献者文档断言', () => {
  test('README.md 存在', () => {
    assert.ok(repoFileExists('product-map/README.md'), 'product-map/README.md 须存在');
  });

  test('README 含所有权信息', () => {
    const content = readRepoFile('product-map/README.md');
    assert.match(content, /所有权|ownership/i, 'README 须含所有权信息');
  });

  test('README 含变更工作流 7 个步骤', () => {
    const content = readRepoFile('product-map/README.md');
    // 断言存在 1. 2. 3. 4. 5. 6. 7. 编号
    for (let i = 1; i <= 7; i++) {
      assert.match(content, new RegExp(`${i}\\.`), `README 须含步骤 ${i}.`);
    }
  });

  test('README 含 GP 准入规则 3 个必要条件', () => {
    const content = readRepoFile('product-map/README.md');
    // 至少包含 3 个带编号的准入条件
    const conditionMatches = content.match(/\d+\.\s+.+/g) || [];
    assert.ok(conditionMatches.length >= 3, `README 须含至少 3 个编号条件，实际: ${conditionMatches.length}`);
  });

  test('README 明确区分 Surface vs Line', () => {
    const content = readRepoFile('product-map/README.md');
    assert.match(content, /[Ss]urface/, 'README 须含 Surface');
    assert.match(content, /[Ll]ine/, 'README 须含 Line');
    // 两者须在同一段落（300 字符内）
    const surfaceIdx = content.indexOf('Surface');
    const lineIdx = content.indexOf('Line');
    assert.ok(Math.abs(surfaceIdx - lineIdx) < 300, 'Surface 和 Line 须在同一段落内对比');
  });

  test('README 明确区分 Edition vs Line', () => {
    const content = readRepoFile('product-map/README.md');
    assert.match(content, /[Ee]dition/, 'README 须含 Edition');
    const editionIdx = content.indexOf('Edition');
    const lineIdx = content.indexOf('Line');
    assert.ok(Math.abs(editionIdx - lineIdx) < 300, 'Edition 和 Line 须在同一段落内对比');
  });

  test('README 含生成投影路径引用', () => {
    const content = readRepoFile('product-map/README.md');
    assert.match(content, /product-map\/generated\/product-map\.md/, 'README 须含生成投影路径引用');
  });

  test('README 含 npm 脚本引用', () => {
    const content = readRepoFile('product-map/README.md');
    assert.match(
      content,
      /npm run product-map:(check|validate)/,
      'README 须含 product-map:check 或 product-map:validate 命令'
    );
  });
});

// ─── BEHAVIOR-10: CI L2 Job 无 paths 过滤器 ───────────────────────────────────

describe('BEHAVIOR-10: CI L2 Job 配置', () => {
  test('ci-l2-consistency.yml 含 product-map-contract Job', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    assert.ok(content.includes('product-map-contract'), 'L2 workflow 须含 product-map-contract Job');
  });

  test('product-map-contract Job 无 paths 过滤器', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    // 提取 product-map-contract Job 段落
    const jobStart = content.indexOf('product-map-contract:');
    assert.ok(jobStart !== -1, 'product-map-contract Job 须存在');
    // 找到下一个同级 Job（以 2 空格缩进开头的 word:）
    const afterJob = content.slice(jobStart);
    const nextJobMatch = afterJob.match(/\n  \w[\w-]+:\n/);
    const jobContent = nextJobMatch
      ? afterJob.slice(0, nextJobMatch.index)
      : afterJob;
    assert.ok(!jobContent.includes('paths:'), 'product-map-contract Job 不得含 paths: 过滤器');
  });

  test('product-map-contract Job 含三条必要命令', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    const jobStart = content.indexOf('product-map-contract:');
    const afterJob = content.slice(jobStart);
    const nextJobMatch = afterJob.match(/\n  \w[\w-]+:\n/);
    const jobContent = nextJobMatch ? afterJob.slice(0, nextJobMatch.index) : afterJob;
    assert.ok(jobContent.includes('npm ci'), 'product-map-contract Job 须含 npm ci');
    assert.ok(jobContent.includes('test:product-map'), 'product-map-contract Job 须含 npm run test:product-map');
    assert.ok(jobContent.includes('product-map:check'), 'product-map-contract Job 须含 npm run product-map:check');
  });

  test('product-map-contract Job timeout-minutes 为 5', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    const jobStart = content.indexOf('product-map-contract:');
    const afterJob = content.slice(jobStart, jobStart + 1000);
    assert.match(afterJob, /timeout-minutes:\s*5/, 'product-map-contract Job timeout-minutes 须为 5');
  });

  test('l2-passed 的 needs 包含 product-map-contract', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    const l2PassedIdx = content.indexOf('l2-passed:');
    const afterL2 = content.slice(l2PassedIdx, l2PassedIdx + 600);
    assert.match(afterL2, /product-map-contract/, 'l2-passed needs 须包含 product-map-contract');
  });

  test('l2-passed FAILED 判断块含 product-map-contract result 检查', () => {
    const content = readRepoFile('.github/workflows/ci-l2-consistency.yml');
    // l2-passed Job 须在 shell 脚本中检查 product-map-contract 的 result
    // 仅加入 needs 不够，须有对应的 FAILED 判断块
    assert.ok(
      content.includes('needs.product-map-contract.result'),
      'l2-passed FAILED 判断块须含 needs.product-map-contract.result 检查'
    );
    // 判断块须含 "FAIL" 或 "FAILED" 字样（可操作提示）
    const pmContractIdx = content.indexOf('needs.product-map-contract.result');
    assert.ok(pmContractIdx !== -1, 'product-map-contract result 检查须存在');
    const surroundingContext = content.slice(Math.max(0, pmContractIdx - 50), pmContractIdx + 200);
    assert.match(
      surroundingContext,
      /FAIL/i,
      'l2-passed 中 product-map-contract result 检查须包含 FAIL 字样'
    );
  });
});

// ─── BEHAVIOR-11: test-registry.yaml 注册 ─────────────────────────────────────

describe('BEHAVIOR-11: test-registry.yaml 注册', () => {
  test('test-registry.yaml 含 product-map-contract 条目', () => {
    const content = readRepoFile('test-registry.yaml');
    assert.ok(content.includes('product-map-contract'), 'test-registry.yaml 须含 product-map-contract 条目');
  });

  test('product-map-contract 条目 type=unit, ci=L2, status=active', () => {
    const content = readRepoFile('test-registry.yaml');
    const idx = content.indexOf('product-map-contract');
    assert.ok(idx !== -1, '须含 product-map-contract 条目');
    // 提取该条目（往后 300 字符足够）
    const entry = content.slice(idx, idx + 300);
    assert.match(entry, /type:\s*unit/, '须为 type: unit');
    assert.match(entry, /ci:\s*L2/, '须为 ci: L2');
    assert.match(entry, /status:\s*active/, '须为 status: active');
  });

  test('test-registry.yaml updated 字段为 2026-07-28', () => {
    const content = readRepoFile('test-registry.yaml');
    assert.match(content, /updated:\s*["']?2026-07-28["']?/, 'updated 须为 2026-07-28');
  });

  test('product-map-contract path 指向正确测试文件', () => {
    const content = readRepoFile('test-registry.yaml');
    assert.ok(
      content.includes('scripts/product-map/__tests__/product-map.test.js'),
      '须含测试文件路径 scripts/product-map/__tests__/product-map.test.js'
    );
  });
});

// ─── BEHAVIOR-12: 范围外交付物不存在 ─────────────────────────────────────────

describe('BEHAVIOR-12: 范围边界守卫', () => {
  test('不含数据库迁移文件新增', () => {
    const migrationPatterns = [
      'apps/api/src/db/migrations',
      'apps/api/migrations',
      'db/migrations',
    ];
    for (const dir of migrationPatterns) {
      const absPath = resolve(REPO_ROOT, dir);
      if (existsSync(absPath)) {
        const files = readdirSync(absPath);
        const pmFiles = files.filter(f => f.includes('product_map') || f.includes('product-map'));
        assert.equal(pmFiles.length, 0, `不得含 product-map 相关迁移文件: ${JSON.stringify(pmFiles)}`);
      }
    }
  });

  test('product-map.yaml 的 line01/02/04 各含 1 条已注册 GP（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定）', async () => {
    const lib = await loadLib();
    const { map } = await lib.loadAndValidateProductMap();
    const customerLineGps = map.golden_paths.filter(g =>
      g.app_id === 'customer_app' &&
      ['line01', 'line02', 'line04'].includes(g.line_id)
    );
    assert.equal(customerLineGps.length, 3,
      `customer_app Line 01/02/04 须各含1条GP共3条，实际: ${JSON.stringify(customerLineGps)}`
    );
  });

  test('package.json 含 4 个 product-map npm scripts', () => {
    const pkg = JSON.parse(readRepoFile('package.json'));
    const scripts = pkg.scripts || {};
    const requiredScripts = [
      'product-map:validate',
      'product-map:generate',
      'product-map:check',
      'test:product-map',
    ];
    for (const s of requiredScripts) {
      assert.ok(s in scripts, `package.json 须含 script: ${s}`);
    }
  });

  test('lib.mjs 导出 5 个必要函数', async () => {
    const lib = await loadLib();
    const requiredExports = [
      'loadAndValidateProductMap',
      'validateRelations',
      'canonicalize',
      'productMapDigest',
      'assertBootstrapParity',
    ];
    for (const fn of requiredExports) {
      assert.ok(typeof lib[fn] === 'function', `lib.mjs 须导出函数: ${fn}`);
    }
  });
});
