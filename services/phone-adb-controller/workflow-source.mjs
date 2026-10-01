import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, fstatSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_REPO = 'perfectuser21/zenithjoy-workspace';
export const PRODUCER_PATH = 'services/phone-adb-controller/workflow-result.sh';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

// 来源只能由正规部署从真实 Git 对象生成；禁止给脏工作区或其他仓库贴 revision。
export function deploymentManifest(repo, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('source_revision_invalid');
  const origin = git(repo, 'remote', 'get-url', 'origin');
  if (!/^(?:git@github\.com:|https:\/\/github\.com\/)perfectuser21\/zenithjoy-workspace(?:\.git)?$/.test(origin)) {
    throw new Error('source_repository_mismatch');
  }
  if (git(repo, 'rev-parse', 'HEAD') !== revision || git(repo, 'status', '--porcelain', '--untracked-files=no')) {
    throw new Error('source_checkout_not_clean_revision');
  }
  git(repo, 'merge-base', '--is-ancestor', revision, 'origin/main');
  const object = execFileSync('git', ['-C', repo, 'show', `${revision}:${PRODUCER_PATH}`]);
  const deployed = readFileSync(join(repo, PRODUCER_PATH));
  if (!object.equals(deployed)) throw new Error('source_producer_not_git_object');
  return { schema_version: 1, source_repo: SOURCE_REPO, source_sha: revision,
    producer_path: PRODUCER_PATH, producer_sha256: digest(object) };
}

// 对账允许与当前 main 字节相同的较早部署，仍核该 revision 的真实 Git 对象与祖先关系。
export function verifyPublishedSource(repo, targetRevision, source) {
  const p = source?.source_provenance;
  if (!/^[a-f0-9]{40}$/.test(source?.source_sha ?? '') || p?.status !== 'verified'
      || p.source_repo !== SOURCE_REPO || p.producer_path !== PRODUCER_PATH
      || !/^[a-f0-9]{64}$/.test(p.producer_sha256 ?? '')) throw new Error('published_source_invalid');
  git(repo, 'merge-base', '--is-ancestor', source.source_sha, targetRevision);
  const object = execFileSync('git', ['-C', repo, 'show', `${source.source_sha}:${PRODUCER_PATH}`]);
  if (digest(object) !== p.producer_sha256) throw new Error('published_source_not_git_object');
  return { verified: true, source_sha: source.source_sha };
}

export function runtimeSource(producer, executionFd = null) {
  const unknown = reason => ({ source_sha: null, source_provenance: {
    status: 'unknown', reason, source_repo: SOURCE_REPO, producer_path: PRODUCER_PATH } });
  try {
    if (basename(producer) !== 'workflow-result.sh') return unknown('producer_path_mismatch');
    const manifest = JSON.parse(readFileSync(join(dirname(producer), 'workflow-result.source.json'), 'utf8'));
    if (manifest.schema_version !== 1 || manifest.source_repo !== SOURCE_REPO
        || manifest.producer_path !== PRODUCER_PATH || !/^[a-f0-9]{40}$/.test(manifest.source_sha ?? '')
        || !/^[a-f0-9]{64}$/.test(manifest.producer_sha256 ?? '')) return unknown('source_manifest_invalid');
    let bytes;
    if (executionFd !== null) {
      if (executionFd !== '/dev/stdin') return unknown('producer_execution_fd_invalid');
      const info = fstatSync(0);
      if (!info.isFile() || info.size > 10 * 1024 * 1024) return unknown('producer_execution_fd_invalid');
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const size = readSync(0, bytes, offset, bytes.length - offset, offset);
        if (!size) return unknown('producer_execution_fd_incomplete');
        offset += size;
      }
    } else bytes = readFileSync(producer);
    const actual = digest(bytes);
    if (manifest.producer_sha256 !== actual) return unknown('producer_hash_mismatch');
    return { source_sha: manifest.source_sha, source_provenance: {
      status: 'verified', source_repo: SOURCE_REPO, producer_path: PRODUCER_PATH, producer_sha256: actual } };
  } catch { return unknown('source_manifest_unavailable'); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'read') console.log(JSON.stringify(runtimeSource(process.argv[3], process.argv[4] ?? null)));
  else if (process.argv[2] === 'manifest') console.log(JSON.stringify(deploymentManifest(process.argv[3], process.argv[4])));
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(verifyPublishedSource(process.argv[3], process.argv[4], JSON.parse(process.argv[5]))));
  else throw new Error('usage: workflow-source.mjs read <producer> | manifest <repo> <revision>');
}
