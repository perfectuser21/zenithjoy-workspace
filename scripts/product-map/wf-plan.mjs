#!/usr/bin/env node
/**
 * wf-plan.mjs — 契约组装 → 执行计划（决策 7f842d12：Commander 当入口 + 契约组装执行）
 *
 * 执行机（xian-m4/xian-m1）上没有仓库 node_modules，所以计划在交互机生成、提交进仓库：
 *   services/phone-adb-controller/plans/<能力>.plan，deploy.sh 同步到执行机 ~/bin-harvest/plans/，
 *   wf-run.sh source 它。CI 用 --check 保证提交的计划与契约一致（改契约不重生成 = 红）。
 *
 * 用法:
 *   node scripts/product-map/wf-plan.mjs <能力> [--allow-missing]   stdout 输出可 eval 的 shell 赋值
 *   node scripts/product-map/wf-plan.mjs --write                    重生成全部 plans/*.plan
 *   node scripts/product-map/wf-plan.mjs --check                    校验提交的 plans/*.plan 与契约一致
 *
 * 拒跑（exit 1）：组装不 ok / 任一活动缺 runtime / phase=source 活动不是恰好一个 / 源类型认不出；
 * 任一步骤 implementation=missing 默认也拒跑（无实现不得跑），--allow-missing 放行但记入 WF_MISSING。
 * 计划文件一律按 --allow-missing 生成并带 WF_MISSING，由 wf-run.sh 在运行时再拦一次（它也有 --allow-missing）。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk, assemble, contractsDigest, contractHash } from './contracts-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLANS_DIR = 'services/phone-adb-controller/plans';

// 源类型由发现活动的输入对象类型决定；wf-run.sh 按它选取源方式（词单 / 对标清单文件）
const SOURCE_KINDS = { Keyword: 'keyword', BenchmarkAccount: 'benchmark' };
const SOURCE_STAGE = { keyword: '取词单', benchmark: '取对标源' };

// 阶段串固定 5 段，下标与 wf-run.sh / batch2.sh 的 `wr step <n>` 一一对应（batch2 写死第 3 段逐词上报）：
//   0 拉Commander / 1 setup 活动 / 2 取源 / 3 source+per_item+batch_end 活动 / 4 效果回写；finalize 活动在 trap 里跑，不占段
function stagesOf(acts, kind) {
  const names = (phases) => acts.filter((a) => phases.includes(a.runtime.phase) && !a.runtime.detached).map((a) => a.name).join('·');
  return ['拉Commander', names(['setup']), SOURCE_STAGE[kind], names(['source', 'per_item', 'batch_end']), '效果回写'].join(',');
}

export function planFor(ctx, capId, { allowMissing = false } = {}) {
  const r = assemble(ctx, capId);
  if (!r.ok) return { ok: false, errors: r.errors, activities: r.activities };
  const acts = r.activities;
  const errors = [];
  const doc = ctx.contracts[capId];
  if (!/^[a-z][a-z0-9_]+$/.test(doc.brain_workflow_key || '')) errors.push(`${capId}: 缺有效 brain_workflow_key`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(doc.source_repo || '')) errors.push(`${capId}: 缺有效 source_repo`);
  for (const a of acts) if (!a.runtime) errors.push(`${capId}.${a.key}: 缺 runtime（无实现绑定不得跑）`);
  const missing = acts.flatMap((a) => (a.steps || []).filter((s) => s.implementation?.status === 'missing').map((s) => `${a.key}.${s.key}`));
  if (missing.length && !allowMissing) errors.push(`${capId}: 步骤 implementation=missing 不得跑（无实现不得跑，真机调试加 --allow-missing）：${missing.join(', ')}`);
  if (errors.length) return { ok: false, errors, activities: acts };

  const sources = acts.filter((a) => a.runtime.phase === 'source');
  if (!doc.runner && sources.length !== 1) return { ok: false, errors: [`${capId}: phase=source 的活动必须恰好一个，实有 ${sources.length}`], activities: acts };
  const [src] = sources;
  const kinds = doc.runner ? [doc.runner.queue] : [...new Set(src.inputs.map((i) => SOURCE_KINDS[i.type]).filter(Boolean))];
  if (kinds.length !== 1) return { ok: false, errors: [`${capId}.${src.key}: 输入里认不出唯一源类型（Keyword/BenchmarkAccount）`], activities: acts };
  if (doc.runner && acts.some(a => a.commander?.entry !== 'activity-commander.mjs')) {
    return { ok: false, errors: [`${capId}: 新流程每个活动必须绑定Commander`], activities: acts };
  }

  const env = {
    WF_CAP: capId,
    WF_WORKFLOW: ctx.contracts[capId].workflow,
    WF_BRAIN_WORKFLOW: doc.brain_workflow_key,
    WF_SOURCE_REPO: doc.source_repo,
    WF_CONTRACT_SHA256: contractsDigest(ctx).capabilities[capId].sha256,
    WF_CONTRACT_RAW_SHA256: contractHash(doc),
    WF_ACTIVITY_REFS: JSON.stringify(acts.map(a => {
      const { from, ...contract } = a;
      return { slot_key: a.key, sequence_no: a.order, definition_key: `${from}.${a.key}`, source_capability: from, contract_sha256: contractHash(contract) };
    })),
    WF_STEP_SPEC: `plans/${capId}.steps.json`,
    WF_STAGES: doc.runner ? acts.map(a => a.name).join(',') : stagesOf(acts, kinds[0]),
    WF_SOURCE_KIND: kinds[0],
    WF_DISCOVER_CMD: doc.runner ? '' : src.runtime.entry,
    WF_MISSING: missing.join(','),
  };
  if (doc.runner) env.WF_RUNNER = doc.runner.entry;
  if (doc.lifecycle === 'retired') env.WF_RETIRED = '1';
  // 7d150e33（阶段1）：每活动 budget.max_duration_s 编进计划，执行器按它封顶各活动段（缺 budget = 0 = 不限）；
  // 超时时按契约 failure 分类：retryable 里声明了超时类条目 → retryable（重试一次），否则 record（记账后进入下一单元）
  for (const a of acts) env[`WF_BUDGET_${a.key}`] = String(a.budget?.max_duration_s ?? 0);
  for (const a of acts) env[`WF_TIMEOUT_CLASS_${a.key}`] = timeoutClass(a);
  return { ok: true, errors: [], activities: acts, env };
}

// 超时算不算 retryable：看活动 failure.retryable 有没有把超时/远程调用失败声明成可重试（delivery 的「scp/ssh 失败」即是）
const TIMEOUT_RETRYABLE_RE = /超时|timeout|scp\/ssh 失败/i;
function timeoutClass(a) {
  return (a.failure?.retryable || []).some((s) => TIMEOUT_RETRYABLE_RE.test(String(s))) ? 'retryable' : 'record';
}

const sq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
export function renderEnv(env) {
  return Object.entries(env).map(([k, v]) => `${k}=${sq(v)}`).join('\n') + '\n';
}

function planFile(ctx, capId) {
  const r = planFor(ctx, capId, { allowMissing: true });
  if (!r.ok) return r;
  return { ...r, text: `# 由 scripts/product-map/wf-plan.mjs --write 从 product-map/contracts/${capId}.yaml 生成，勿手改\n${renderEnv(r.env)}` };
}

function main(argv) {
  const ctx = loadContractsFromDisk();
  const dir = join(REPO_ROOT, PLANS_DIR);
  if (argv[0] === '--write' || argv[0] === '--check') {
    let bad = 0;
    const want = new Set();
    for (const capId of Object.keys(ctx.contracts).sort()) {
      const r = planFile(ctx, capId);
      if (!r.ok) { console.error(`FAIL ${capId}:\n  ${r.errors.join('\n  ')}`); bad = 1; continue; }
      const p = join(dir, `${capId}.plan`);
      want.add(`${capId}.plan`);
      if (argv[0] === '--write') { mkdirSync(dir, { recursive: true }); writeFileSync(p, r.text); console.log(`wrote ${PLANS_DIR}/${capId}.plan`); continue; }
      if (!existsSync(p) || readFileSync(p, 'utf8') !== r.text) { console.error(`FAIL drift: ${PLANS_DIR}/${capId}.plan 与契约不符，跑 node scripts/product-map/wf-plan.mjs --write`); bad = 1; }
    }
    if (argv[0] === '--check' && existsSync(dir)) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.plan') && !want.has(n))) { console.error(`FAIL orphan: ${PLANS_DIR}/${f} 无对应契约`); bad = 1; }
    }
    if (!bad && argv[0] === '--check') console.log('PASS: plans/*.plan 与契约一致');
    return bad;
  }
  const capId = argv.find((a) => !a.startsWith('--'));
  if (!capId) { console.error('用法: wf-plan.mjs <能力> [--allow-missing] | --write | --check'); return 1; }
  const r = planFor(ctx, capId, { allowMissing: argv.includes('--allow-missing') });
  if (!r.ok) { console.error(`拒跑 ${capId}:\n  ${r.errors.join('\n  ')}`); return 1; }
  process.stdout.write(renderEnv(r.env));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
