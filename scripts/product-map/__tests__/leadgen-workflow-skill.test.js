import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadContractsFromDisk, validateContracts, commanderContractsSpec, COMMANDER_SKILLS_DIR } from '../contracts-lib.mjs';

const keys = ['douyin_video_discovery', 'douyin_video_processing', 'douyin_comment_scoring', 'douyin_lead_outreach'];

test('四个 wf_run 合同通过原机制加载对应0.2.0陪跑Skill，保留执行边界', () => {
  const ctx = loadContractsFromDisk();
  for (const [index, key] of keys.entries()) {
    const doc = ctx.contracts[key];
    assert.deepEqual(doc.commander_skill, { name: `wf-${key}`, version: key==='douyin_video_processing'?'0.2.2':'0.2.1' }, key);
    assert.equal(doc.runner.entry, 'leadgen-workflow.mjs');
    assert.notEqual(doc.execution_profile, 'codex_agent');
    const text = readFileSync(join(ctx.repoRoot, COMMANDER_SKILLS_DIR, doc.commander_skill.name, 'SKILL.md'), 'utf8');
    const frontmatter = parse(text.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.equal(frontmatter.name, doc.commander_skill.name);
    assert.equal(frontmatter.version, doc.commander_skill.version);
    const business = `douyin-leadgen-${101 + index}`;
    assert.ok(text.includes(`services/phone-adb-controller/skills/${business}/SKILL.md`));
    assert.ok(text.includes(`runtime/skills/${business}/SKILL.md`));
    assert.ok(text.includes('本run已验证的冻结部署清单'));
    assert.ok(text.includes('execution_path'), 'Activity独立方法必须读取本run真实冻结执行路径');
    assert.ok(text.includes('Agent 显式加载'));
    assert.ok(text.includes('自动调用未接好'));
    assert.ok(text.includes('BLOCKED'));
    assert.equal(commanderContractsSpec(ctx).contracts[key], undefined, '不能把wf_run冒充codex_agent自动调用');
  }
  assert.deepEqual(validateContracts(ctx), []);
});

test('四个陪跑映射缺文件或版本漂移时原合同门禁拒绝', () => {
  for (const key of keys) {
    const missing = loadContractsFromDisk();
    missing.contracts[key].commander_skill = { name: 'wf-not_exist_leadgen', version: '0.1.0' };
    assert.ok(validateContracts(missing).some(e => e.includes(key) && /commander_skill.*不存在/.test(e)));
    const drift = loadContractsFromDisk();
    drift.contracts[key].commander_skill = { name: `wf-${key}`, version: '9.9.9' };
    assert.ok(validateContracts(drift).some(e => e.includes(key) && /commander_skill.*版本/.test(e)));
  }
});
