import { realpathSync, appendFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function resolveManualE2e({ workspace, candidate, actualSha, taskId, sprintDir }) {
  if (!/^[a-f0-9]{40}$/i.test(candidate ?? '')) throw new Error('candidate must be a fixed 40-character commit SHA');
  if (candidate.toLowerCase() !== actualSha?.toLowerCase()) throw new Error('checkout is not the selected candidate');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(taskId ?? '')) throw new Error('task_id must be a UUID');
  if (!sprintDir || /[\r\n]/.test(sprintDir) || isAbsolute(sprintDir)) throw new Error('sprint_dir must be a relative sprints directory');
  const root = realpathSync(resolve(workspace, 'sprints'));
  const script = realpathSync(resolve(workspace, sprintDir, 'e2e-verify.ps1'));
  const rel = relative(root, script);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('verification script must remain within repository sprints');
  return script;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const script = resolveManualE2e({ workspace, candidate: process.env.CANDIDATE_SHA,
    actualSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
    taskId: process.env.TASK_ID, sprintDir: process.env.SPRINT_DIR });
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `script_path=${script}\n`);
  console.log(`Manual E2E candidate=${process.env.CANDIDATE_SHA} task=${process.env.TASK_ID} script=${script}`);
}
