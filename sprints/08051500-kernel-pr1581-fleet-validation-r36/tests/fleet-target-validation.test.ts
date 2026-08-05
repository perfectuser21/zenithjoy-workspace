import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const sprint = 'sprints/08051500-kernel-pr1581-fleet-validation-r36';

describe('Fleet payload 验收合同 [BEHAVIOR]', () => {
  it('合同要求原始 payload 三字段', async () => {
    const contract = await readFile(`${sprint}/contract-draft.md`, 'utf8');
    expect(contract).toContain('base_repo=="perfectuser21/zenithjoy-workspace"');
    expect(contract).toContain('target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189"');
    expect(contract).toContain('gp_anchor=="line02/keyword_acquisition#step7"');
  });

  it('合同要求 PR head、checkout 与结果证据同 SHA', async () => {
    const contract = await readFile(`${sprint}/contract-draft.md`, 'utf8');
    expect(contract).toContain('pulls/1581');
    expect(contract).toContain("git rev-parse --verify 'HEAD^{commit}'");
    expect(contract).toContain('.evidence.candidate_sha==$p[0].target_head_sha');
  });

  it('合同拒绝三个篡改变体', async () => {
    const dod = await readFile(`${sprint}/contract-dod.md`, 'utf8');
    expect(dod).toContain('del(.base_repo)');
    expect(dod).toContain('.target_head_sha=\"short\"');
    expect(dod).toContain('.gp_anchor=\"line02/keyword_acquisition#step6\"');
  });

  it('合同使用 late-bound evaluator identity', async () => {
    const contract = await readFile(`${sprint}/contract-draft.md`, 'utf8');
    for (const key of ['HARNESS_ATTEMPT_ID', 'HARNESS_PROVIDER', 'HARNESS_ACCOUNT', 'HARNESS_MACHINE', 'HARNESS_MODEL', 'HARNESS_RUNNER_DIGEST', 'CAPABILITY_SNAPSHOT_ID']) {
      expect(contract).toContain(`\${${key}`);
    }
    expect(contract).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it('合同不要求新增生产 verifier 或结果 schema', async () => {
    const contract = await readFile(`${sprint}/contract-draft.md`, 'utf8');
    const plan = JSON.parse(await readFile(`${sprint}/task-plan.json`, 'utf8'));
    expect(contract).not.toContain('scripts/harness/verify-fleet-target.mjs');
    expect(plan.tasks.flatMap((task: { files: string[] }) => task.files).every((file: string) => file.startsWith(`${sprint}/`))).toBe(true);
  });
});
