import { describe, expect, it } from 'vitest';
import { representativeEvidence, representativeDocs } from '../../tests/fixtures/company-wiki-evidence';
import { validateCompanyIdentity, validateEnabledCompany } from './company-profile-validation';
import { buildSeeds } from '../../scripts/company-wiki-import.mjs';

const mapping = {
  jinoshengyuan: { company_id: '11111111-1111-4111-8111-111111111111', tenant_id: 'aaaaaaaa-1111-4111-8111-111111111111', owner: 'fixture-owner-a', verification_source: '隔离测试绑定' },
  yueshengyun: { company_id: '22222222-2222-4222-8222-222222222222', tenant_id: 'bbbbbbbb-2222-4222-8222-222222222222', owner: 'fixture-owner-b', verification_source: '隔离测试绑定' },
};
const seeds = () => buildSeeds(structuredClone(representativeEvidence), representativeDocs, mapping);

describe('公司种子导入、API启用校验与来源保留合同', () => {
  it('两家公司经真实导入器生成的业务规则均满足启用结构，原资料初稿和未核验账号保持原状态', () => {
    for (const seed of seeds()) {
      expect(validateEnabledCompany(seed)).toBeNull();
      expect(validateCompanyIdentity(structuredClone(seed), seed)).toBeNull();
      expect(seed.products).toEqual(seed.wiki.products.map((product: { id: string; name: string }) => product.name));
      expect(seed.runtime_config.product_ids).toEqual(seed.wiki.products.map((product: { id: string; name: string }) => product.id));
      expect(seed.config_status).toBe('draft');
      expect(seed.wiki.verification_status).toBe('source_preserved_pending_owner_review');
      expect(seed.runtime_config.platform_accounts.every((account: { verification_status: string; enabled: boolean }) => account.verification_status === 'unverified' && account.enabled === false)).toBe(true);
    }
  });

  it('导入器拒绝未核实身份，避免校验器拿无归属资料当完整配置', () => {
    expect(() => buildSeeds(representativeEvidence, representativeDocs, {})).toThrow(/mapping/);
  });

  it('目标来源可保留原跨Base记录，编辑本公司Wiki不会抹掉来源，但不能新增另一公司的产品', () => {
    const evidence = structuredClone(representativeEvidence);
    evidence.companies.jinuo.tables.push({
      table_id: 'tblpwc9GF9mIhdAG', name: '跨公司目标来源示例', config: true, all_config_rows_read: true, total: 1,
      rows: [{ record_id: 'fixture-shared-goal', fields: { 业务线: '悦升云端', 目标: '示例目标' } }],
    });
    const [companyA, companyB] = buildSeeds(evidence, representativeDocs, mapping);
    expect(companyB.runtime_config.business_goals[0].source.base).toBe(companyA.source_evidence.base);
    const edited = structuredClone(companyB);
    edited.wiki.markdown += '\n负责人补充本公司正文';
    expect(validateCompanyIdentity(edited, companyB)).toBeNull();
    expect(edited.runtime_config.business_goals).toEqual(companyB.runtime_config.business_goals);
    edited.wiki.products.push(structuredClone(companyA.wiki.products[0]));
    expect(validateCompanyIdentity(edited, companyB)).not.toBeNull();
  });

  it('源记录身份即使不变，编辑器仍不能借另一公司账号设备或自证已核验后开启', () => {
    const [companyA, companyB] = seeds();
    const original = companyA.runtime_config.platform_accounts[0];
    const foreign = companyB.runtime_config.platform_accounts[0];
    const borrowed = structuredClone(companyA);
    borrowed.runtime_config.platform_accounts[0] = { ...original, douyin_id: foreign.fields.抖音号, device_serial: 'fixture-machine-b' };
    expect(validateCompanyIdentity(borrowed, companyA)).not.toBeNull();
    const selfVerified = structuredClone(companyA);
    selfVerified.runtime_config.platform_accounts[0].verification_status = 'verified';
    selfVerified.runtime_config.platform_accounts[0].enabled = true;
    expect(validateCompanyIdentity(selfVerified, companyA)).not.toBeNull();
    const unverifiedEnabled = structuredClone(companyA);
    unverifiedEnabled.runtime_config.platform_accounts[0].enabled = true;
    expect(validateCompanyIdentity(unverifiedEnabled, companyA)).not.toBeNull();
  });
});
