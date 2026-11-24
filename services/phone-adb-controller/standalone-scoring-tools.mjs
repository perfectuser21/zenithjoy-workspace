const runTag = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const operations = ['score_scope','score','score_readback','mark_leads','mark_readback','bridge_outreach','bridge_readback'];
const fail = suffix => { throw Object.assign(Error(`STANDALONE_SCORING_${suffix}`), { code: `STANDALONE_SCORING_${suffix}` }); };
const idsMatch = (left, right) => Array.isArray(left) && left.length === right.length && left.every((id, index) => id === right[index]);
const validIds = ids => Array.isArray(ids) && ids.length <= 1 && ids.every(id => typeof id === 'string' && uuid.test(id));

// Agent 选择业务步骤。宿主使用固定来源、公司与额度调用现有工具，并从同一批记录独立读回。
export function createStandaloneScoringTools({ scope, rpc, assertAuthority }) {
  if (scope?.workflow_key !== 'douyin_comment_scoring' || scope.profile !== 'mmv-scoring' || scope.serial !== 'none'
    || scope.limit !== 1 || ![scope.run_tag, scope.source_run].every(value => typeof value === 'string' && runTag.test(value))
    || scope.run_tag === scope.source_run || typeof scope.line !== 'string' || !runTag.test(scope.line)
    || ![scope.company?.company_id, scope.company?.tenant_id].every(value => typeof value === 'string' && uuid.test(value))
    || !Number.isSafeInteger(scope.company.version) || scope.company.version < 1 || !scope.company.policy_id
    || typeof rpc !== 'function' || typeof assertAuthority !== 'function') fail('SCOPE');
  const { run_tag: run, line, source_run, company } = structuredClone(scope);
  let selected, marked, bridged, scoreVerified = false, markVerified = false, busy = false;
  const attempted = new Set();

  async function queue(op, fields = {}) {
    await assertAuthority();
    const response = await rpc({ kind:'queue', request:{ op, line, run, source_run, limit:1, ...fields } });
    await assertAuthority();
    if (response?.ok !== true || !response.result || typeof response.result !== 'object') fail('BUSINESS_RECEIPT');
    return response.result;
  }
  async function once(op, fields) {
    if (attempted.has(op)) fail('ALREADY_ATTEMPTED');
    attempted.add(op);
    return queue(op, fields);
  }
  async function readMark() {
    if (!marked) fail('SEQUENCE');
    const proof = await queue('mark_readback', marked);
    if (proof.verified !== true || proof.failures !== 0 || !idsMatch(proof.ids, marked.ids) || !idsMatch(proof.lead_ids, marked.lead_ids)) fail('MARK_READBACK');
    return proof;
  }
  async function readDelivery() {
    if (!bridged) fail('SEQUENCE');
    if (bridged.ids.length === 0) return { verified:true, ids:[], states:{} };
    const proof = await queue('bridge_readback', { ids:bridged.ids });
    if (proof.verified !== true || proof.failures !== 0 || !idsMatch(proof.ids, bridged.ids)
      || !proof.states || Object.keys(proof.states).length !== bridged.ids.length
      || bridged.ids.some(id => !['confirmed','excluded'].includes(proof.states[id]))) fail('DELIVERY_READBACK');
    return proof;
  }
  const actions = {
    async score_scope() {
      if (selected) return structuredClone(selected);
      const actual = await queue('company_config', { step:'103' });
      if (actual.run_id !== run || ['company_id','tenant_id','version','policy_id'].some(key => actual[key] !== company[key])) fail('COMPANY');
      const result = await queue('score_scope');
      const ids = Array.isArray(result.ids) ? result.ids.slice(0,1) : null;
      if (!validIds(ids) || !result.sources || ids.some(id => result.sources[id] !== source_run)) fail('SOURCE');
      selected = { ids, sources: Object.fromEntries(ids.map(id => [id, source_run])) };
      return structuredClone(selected);
    },
    async score() {
      if (!selected) fail('SEQUENCE');
      if (!selected.ids.length) fail('NO_ELIGIBLE');
      const result = await once('score', { ...selected, budget_max:1 });
      if (result.scored !== 1 || result.blocked !== 0 || !idsMatch(result.ids, selected.ids)) fail('SCORE_RECEIPT');
      return result;
    },
    async score_readback() {
      if (!attempted.has('score')) fail('SEQUENCE');
      const proof = await queue('score_readback', selected);
      const policy = await queue('policy_review', { ...selected, claim:run });
      if (proof.verified !== true || proof.failures !== 0 || !idsMatch(proof.ids, selected.ids)
        || policy.verified !== true || !idsMatch(policy.ids, selected.ids)) fail('SCORE_READBACK');
      scoreVerified = true;
      return proof;
    },
    async mark_leads() {
      if (!scoreVerified) fail('SEQUENCE');
      const result = await once('mark_leads', { ids:selected.ids });
      if (result.marked !== 1 || result.blocked !== 0 || !idsMatch(result.ids, selected.ids) || !validIds(result.lead_ids)) fail('MARK_RECEIPT');
      marked = { ids:[...selected.ids], lead_ids:[...result.lead_ids] };
      return result;
    },
    async mark_readback() {
      const proof = await readMark();
      markVerified = true;
      return proof;
    },
    async bridge_outreach() {
      if (!markVerified) fail('SEQUENCE');
      const result = marked.lead_ids.length ? await once('bridge_outreach', { comment_ids:marked.ids }) : { verified:true, unknown:0, ids:[] };
      if (result.verified !== true || result.unknown !== 0 || !validIds(result.ids) || result.ids.length !== marked.lead_ids.length) fail('DELIVERY_RECEIPT');
      bridged = { ids:[...result.ids] };
      return result;
    },
    bridge_readback: readDelivery,
  };

  const exclusive = async action => {
    if (busy) fail('BUSY');
    busy = true;
    try { return await action(); } finally { busy = false; }
  };
  return {
    call: (op, input) => exclusive(async () => {
      if (op === 'inspect' && Object.keys(input ?? {}).length === 0) {
        await assertAuthority();
        return { stage:'103', source_run, business_operations:[...operations] };
      }
      if (op !== 'business') fail('OPERATION');
      if (typeof input?.operation !== 'string' || !operations.includes(input.operation)
        || Object.keys(input).some(key => !['operation','input'].includes(key))
        || input.input !== undefined && (!input.input || Array.isArray(input.input) || typeof input.input !== 'object' || Object.keys(input.input).length)) fail('INPUT');
      return actions[input.operation]();
    }),
    readEvidence: () => exclusive(async () => {
      if (!scoreVerified || !markVerified || !bridged) return null;
      const markedProof = await readMark();
      const deliveryProof = await readDelivery();
      return { comment_ids:markedProof.ids, lead_ids:markedProof.lead_ids, delivery_states:deliveryProof.states };
    }),
  };
}
