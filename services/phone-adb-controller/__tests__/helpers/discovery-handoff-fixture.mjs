import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeAcceptedDiscoveryResult(dir, { source, profile, sha }) {
  writeFileSync(join(dir, 'split-result.json'), JSON.stringify({
    status: 'completed',
    run_id: `douyin_video_discovery-${source}__a1`,
    workflow_key: 'douyin_video_discovery',
    source_commit: sha,
    profile,
    evidence_status: 'sent',
    results: [{ activity: 'collect_videos', status: 'completed',
      verification: { verified: true } }],
  }));
}
