import {assembleSources as assembleSharedSources, prepareProof} from './assembly.mjs';
import {qualificationAgentTools} from '../qualification-agent-candidate.mjs';

export {prepareProof};

// Keep the legacy entry readable for old callers. New profiles use the shared adapter.
export function assembleSources(options) {
  const hostTools = options.profile.skill_runtime.host_tools;
  if (options.context.assigned_workflow !== '102' || qualificationAgentTools(hostTools) !== hostTools) {
    throw Error('QUALIFICATION_AGENT_CANDIDATE_PROFILE');
  }
  return assembleSharedSources(options);
}
