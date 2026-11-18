import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, realpathSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startAuditSnapshot, advisoryUrl } from './picomatch-audit-proxy.mjs';

const exec = promisify(execFile);
const fail = suffix => Error('PICOMATCH_AUDIT_' + suffix);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const npmEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function npmScopeArguments(projectRoot, mode) {
  if (mode === 'workspace') return [];
  if (mode === 'standalone') return ['--prefix', projectRoot, '--workspaces=false'];
  throw fail('MODE');
}

export async function npmProjectRoot(projectRoot, mode = 'workspace') {
  const result = await exec('npm', ['prefix', ...npmScopeArguments(projectRoot, mode)], { cwd: projectRoot, env: npmEnvironment(), timeout: 10000 });
  return realpathSync(result.stdout.trim());
}

export function validateAuditReport(text) {
  let report;
  try { report = JSON.parse(text); } catch { throw fail('REPORT_JSON'); }
  if (!object(report) || report.error || report.auditReportVersion !== 2 || !object(report.vulnerabilities)
      || !object(report.metadata?.vulnerabilities)) throw fail('REPORT');
  const counts = Object.fromEntries(severities.map(key => [key, 0]));
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    if (!object(item) || item.name !== name || !severities.includes(item.severity)
        || !Array.isArray(item.via) || !Array.isArray(item.nodes)) throw fail('REPORT_ENTRY');
    counts[item.severity]++;
  }
  for (const key of severities) if (report.metadata.vulnerabilities[key] !== counts[key]) throw fail('REPORT_COUNTS');
  if (report.metadata.vulnerabilities.total !== Object.keys(report.vulnerabilities).length) throw fail('REPORT_COUNTS');
  return report;
}

async function npmAudit({ projectRoot, mode, registry, cache, config, directory, phase }) {
  // Inherited workspace/omit/registry settings must not narrow the declared lock.
  const environment = npmEnvironment();
  let result;
  try {
    result = await exec('npm', ['audit', ...npmScopeArguments(projectRoot, mode), '--json', '--registry', registry,
      '--include=dev', '--include=optional', '--include=peer', '--userconfig', config, '--globalconfig', config + '.global'], {
      cwd: projectRoot, timeout: 240000, maxBuffer: 32 * 1024 * 1024,
      env: { ...environment, npm_config_cache: cache, npm_config_offline: 'false',
        npm_config_omit: '', npm_config_audit: 'true', npm_config_update_notifier: 'false',
        npm_config_fetch_retries: '0', npm_config_fetch_timeout: '45000' },
    });
  } catch (cause) {
    if (cause.code !== 1 || cause.killed || typeof cause.stdout !== 'string') throw cause;
    result = cause;
  }
  writeFileSync(join(directory, phase + '.stdout'), result.stdout, { mode: 0o600 });
  writeFileSync(join(directory, phase + '.stderr'), result.stderr || '', { mode: 0o600 });
  const report = validateAuditReport(result.stdout);
  writeFileSync(join(directory, phase + '.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

export async function auditVerifiedDistribution({ repositoryRoot, projectRoot, mode = 'workspace' }) {
  const { verifyRemediation, isVerifiedRemediation } = await import('./verify-picomatch-remediation.mjs');
  const repository = realpathSync(repositoryRoot), auditCwd = realpathSync(projectRoot);
  if (![repository, join(repository, 'apps/dashboard')].includes(auditCwd)) throw fail('PROJECT_SCOPE');
  // Workspace and standalone releases consume different locks. Bind both npm
  // audit phases and their proof to the explicitly selected installation scope.
  const scope = { repositoryRoot: repository, projectRoot: await npmProjectRoot(auditCwd, mode) };
  const cwdManifest = join(auditCwd, 'package.json'), cwdManifestSha = sha(readFileSync(cwdManifest));
  const proof = verifyRemediation(scope);
  if (!isVerifiedRemediation(proof, scope)) throw fail('UNVERIFIED');
  const assertUnchanged = async () => {
    if (!isVerifiedRemediation(proof, scope) || sha(readFileSync(cwdManifest)) !== cwdManifestSha
        || await npmProjectRoot(auditCwd, mode) !== scope.projectRoot) throw fail('DISTRIBUTION_CHANGED');
  };
  const directory = mkdtempSync(join(tmpdir(), 'picomatch-remediation-audit-'));
  const config = join(directory, 'npmrc');
  writeFileSync(config, '', { mode: 0o600 });
  writeFileSync(config + '.global', '', { mode: 0o600 });
  writeFileSync(join(directory, 'distribution-proof.json'), JSON.stringify(proof, null, 2), { mode: 0o600 });
  const version = (await exec('npm', ['--version'], { timeout: 10000 })).stdout.trim();
  const proxy = await startAuditSnapshot({ versions: proof.versions });
  try {
    const common = { projectRoot: auditCwd, mode, config, directory };
    const raw = await npmAudit({ ...common, phase: 'original', registry: proxy.origin + '/original/', cache: join(directory, 'original-cache') });
    proxy.assertHealthy();
    await assertUnchanged();
    const target = raw.vulnerabilities.picomatch?.via?.filter(v => typeof v === 'object' && v.url === advisoryUrl) || [];
    const bulkTargets = proxy.evidence().original_bulk.flatMap(bulk => bulk.picomatch || []).filter(v => v.url === advisoryUrl);
    if (target.length !== bulkTargets.length) throw fail('RAW_ADVISORY_MISSING');
    let result = raw;
    if (target.length) {
      if (target.length !== 1) throw fail('ADVISORY_COUNT');
      proxy.activateRemediation();
      result = await npmAudit({ ...common, phase: 'remediated', registry: proxy.origin + '/remediated/', cache: join(directory, 'remediated-cache') });
      proxy.assertHealthy();
      if (proxy.evidence().removed_advisories !== 1) throw fail('ADVISORY_COUNT');
      if (result.vulnerabilities.picomatch?.via?.some(v => typeof v === 'object' && v.url === advisoryUrl)) throw fail('RECOMPUTE');
    }
    await assertUnchanged();
    const receipt = { schema_version: 1, npm_version: version, scope: 'locked-distribution',
      advisory_id: proof.advisory_id, policy_id: 'repeated_extglob_rejected', audit_cwd: auditCwd,
      audit_mode: mode, effective_project_root: scope.projectRoot, audit_cwd_package_sha256: cwdManifestSha,
      raw_audit_clean: raw.metadata.vulnerabilities.high + raw.metadata.vulnerabilities.critical === 0,
      verified_remediated_advisories: target.length, raw_counts: raw.metadata.vulnerabilities,
      remediated_counts: result.metadata.vulnerabilities, evidence_directory: directory,
      limitation: '仅修补重复扩展匹配公告；不保证任意raw-regex无ReDoS，不代表已部署',
      snapshot: proxy.evidence() };
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    process.stderr.write(`原始 npm audit 保留于 ${directory}/original.json；仅 ${proof.advisory_id} 已验证修补，其他漏洞仍交原门禁判定。\n`);
    return result;
  } finally {
    writeFileSync(join(directory, 'snapshot.json'), JSON.stringify(proxy.evidence(), null, 2), { mode: 0o600 });
    await proxy.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const mode = process.argv[3] === undefined ? 'workspace' : process.argv[3] === '--standalone' ? 'standalone' : 'invalid';
  auditVerifiedDistribution({ repositoryRoot, projectRoot: resolve(process.argv[2] || '.'), mode })
    .then(report => process.stdout.write(JSON.stringify(report) + '\n'))
    .catch(cause => { process.stderr.write(String(cause.stack || cause) + '\n'); process.exitCode = 2; });
}
