import { probeReadOnly } from './phone-probe.mjs';

// 真机采集接入；尚无经过独立审阅的PDD表单锚点和生产事实，不提供写权限。
export function createReadOnlyRuntime({ probeConfig, deviceBinding, contract = null }, { probe = probeReadOnly } = {}) {
  const config = structuredClone(probeConfig), binding = structuredClone(deviceBinding);
  async function observe() {
    const observation = await probe(config, { deviceBinding: binding });
    return { ok: false, evidence: [observation.manifest], requiresVisualReview: true, observation };
  }
  return {
    contract: contract && structuredClone(contract), productionEnabled: false,
    inspect: observe,
    authorize: async () => ({ ok: false, evidence: [], reasons: ['BUSINESS_FACTS_AND_FORM_ANCHORS_UNVERIFIED'] }),
    act: async () => { throw new Error('PRODUCTION_GATE_CLOSED'); },
    lookup: async () => ({ state: 'unknown', requiresVisualReview: true, observation: await observe() }),
    // probe自身按同owner完成清理/读回；未知远端执行时它会保留有限租约。
    cleanup: async () => {},
  };
}
