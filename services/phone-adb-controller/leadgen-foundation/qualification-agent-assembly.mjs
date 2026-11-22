import fs from 'node:fs';
import path from 'node:path';
import {assembleSources as assemblePublishedSources, EXACT_ENV_KEYS, prepareProof} from './assembly.mjs';
import {hash} from './context.mjs';
import {
  deriveQualificationAgentHost,
  qualificationAgentTools,
} from '../qualification-agent-candidate.mjs';

export {EXACT_ENV_KEYS, prepareProof};

const decisionSource = 'services/phone-adb-controller/qualification-agent-decision.mjs';

export async function assembleSources(options) {
  const {profile, contract, context} = options;
  const hostTools = profile.skill_runtime.host_tools;
  if (context.assigned_workflow !== '102' || qualificationAgentTools(hostTools) !== hostTools) {
    throw Error('QUALIFICATION_AGENT_CANDIDATE_PROFILE');
  }
  const files = await assemblePublishedSources(options);
  const expected = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]));
  return deriveQualificationAgentHost({
    files,
    expected,
    frozenContract: contract,
    candidateSource: fs.readFileSync(path.join(profile.cwd, decisionSource), 'utf8'),
    candidateSha256: profile.files[decisionSource],
    hostTools,
  }).files;
}
