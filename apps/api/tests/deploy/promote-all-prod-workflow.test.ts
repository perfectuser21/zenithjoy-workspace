/** 所有生产入口共享已验收候选与发布实现，防止 all 入口继续使用旧拓扑。 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from 'yaml';
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const workflow = (name: string) => parse(fs.readFileSync(path.join(ROOT, '.github/workflows', `${name}.yml`), 'utf8'));
describe('整体晋级复用单项入口与同一候选', () => {
  it('API 与 dashboard 都经过公共准入并复用生产 workflow', () => {
    const jobs = workflow('promote-all-prod').jobs;
    expect(jobs.admission.uses).toBe('./.github/workflows/release-admission.yml');
    expect(jobs.admission.with.targets).toBe('api,dashboard');
    for (const [job, file] of [['promote-backend', 'promote-prod-hk'], ['promote-frontend', 'promote-dashboard-prod']]) {
      expect(jobs[job].uses).toBe(`./.github/workflows/${file}.yml`);
      expect(jobs[job].with.sha).toBe('${{ needs.admission.outputs.sha }}');
      expect(jobs[job].needs).toContain('admission');
      expect(jobs[job].steps).toBeUndefined();
    }
    expect(jobs['release-tag'].env.DEPLOY_SHA).toBe('${{ needs.admission.outputs.sha }}');
  });
  it('被调用的后端必须使用同一个准入 workflow', () => {
    expect(workflow('promote-prod-hk').jobs.admission.uses).toBe('./.github/workflows/release-admission.yml');
  });
});
