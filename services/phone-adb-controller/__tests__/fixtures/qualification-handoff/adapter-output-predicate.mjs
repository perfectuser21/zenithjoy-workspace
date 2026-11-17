import {sameIdentity} from './skill-protocol.mjs';
export function outputVerdict(verified,result,phase='end'){
return {verdict:phase==='start'||sameIdentity(verified.output,result?.outputs)?'pass':'fail',evidence:verified.checks};
}
