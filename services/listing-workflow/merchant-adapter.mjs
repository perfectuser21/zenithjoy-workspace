// 第一刀接入真实只读采集及业务拒绝路径；尚未实现自动发布驱动，绝不点击发布。
import { evaluatePlan } from './plan-evidence.mjs';

export function createMerchantAdapter({ probe, evidenceContract }) {
  if (typeof probe !== 'function') throw new Error('PROBE_REQUIRED');
  // 合同来自执行方固定配置，独立于客户 payload；不透传任何外部时钟。
  const contract = evidenceContract && structuredClone({ evidenceRoot: evidenceContract.evidenceRoot,
    policy: evidenceContract.policy, maxDocumentBytes: evidenceContract.maxDocumentBytes });
  return {
    async validate(input) {
      const plan = input.payload?.plan || {}, proofs = plan.proofs || {};
      const required = { authorization: 'AUTHORIZATION_UNVERIFIED', supply: 'SUPPLY_UNVERIFIED', edition: 'EDITION_UNVERIFIED', imageOrder: 'IMAGE_ORDER_UNVERIFIED', prices: 'PRICES_UNVERIFIED', promotions: 'PROMOTIONS_UNVERIFIED', digitalServices: 'DIGITAL_SERVICES_UNVERIFIED' };
      const reasons = Object.entries(required).filter(([name]) => proofs[name]?.status !== 'verified' || !proofs[name]?.evidence?.length).map(([, reason]) => reason);
      if (!plan.store || plan.store !== input.target?.store) reasons.push('STORE_UNVERIFIED');
      const comparison = contract ? evaluatePlan({ businessKey: input.businessKey, target: input.target,
        plan: plan.fields, proofs: plan.evidenceDocuments }, { evidenceRoot: contract.evidenceRoot,
        policy: contract.policy, maxDocumentBytes: contract.maxDocumentBytes }) : {
        status: 'unknown', publicationAuthorized: false, factsIndependentlyEstablished: false, checked: [],
        reasons: [{ code: 'EVIDENCE_CONTRACT_UNCONFIGURED', severity: 'unknown' }],
      };
      if (comparison.status !== 'matched') reasons.push('PLAN_EVIDENCE_UNVERIFIED');
      reasons.push('SUBMISSION_DRIVER_UNAVAILABLE');
      return { ok: false, reasons, evidence: [], comparison };
    },
    async submit() { throw new Error('SUBMISSION_DRIVER_UNAVAILABLE'); },
    async lookup(intent) {
      const observation = await probe();
      return { state: 'unknown', requiresVisualReview: true, observation,
        binding: { businessKey: intent.businessKey, intentId: intent.intentId, fingerprint: intent.fingerprint } };
    },
  };
}
