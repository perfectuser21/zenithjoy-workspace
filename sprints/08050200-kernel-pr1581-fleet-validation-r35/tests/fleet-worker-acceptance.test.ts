import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const entry = 'sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs';

describe('Fleet Worker 验收合同 [BEHAVIOR]', () => {
  it('真实 Fleet task 与当前 attempt 绑定冻结目标', async () => {
    const { stdout } = await execFileAsync('node', [entry, '--task-id', process.env.HARNESS_TASK_ID!]);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      status: 'passed', failure_class: null,
      base_repo: 'perfectuser21/zenithjoy-workspace',
      base_sha: '676fed7de12023d355deac7849af8a525ae53f8d',
      target_head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
      gp_anchor: 'line02/keyword_acquisition#step7',
      run_id: process.env.HARNESS_RUN_ID,
      attempt_id: process.env.HARNESS_ATTEMPT_ID,
    });
  });

  it('六种错误均由同一入口给出精确失败分类', async () => {
    const result = await execFileAsync('bash', ['sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh']);
    expect(result.stdout.match(/^REJECTED /gm)).toHaveLength(6);
  });
});
