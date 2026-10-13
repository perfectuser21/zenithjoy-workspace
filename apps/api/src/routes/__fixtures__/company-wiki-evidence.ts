// 去敏的可复现CI资料：只复用字段/关联形状，名称、正文和记录均为测试样本。
const table = (table_id: string, records: Record<string, unknown>[]) => ({
  table_id, name: '示例配置', config: true, all_config_rows_read: true, total: records.length,
  rows: records.map((fields, index) => ({ record_id: `fixture-${table_id}-${index}`, fields })),
});
export const representativeEvidence = {
  read_at: '2026-10-13T00:00:00.000Z',
  companies: {
    jinuo: { base: 'fixture-base-a', tables: [
      table('tblAO4XKqzphBt8f', [{ tenant_id: 'jinoshengyuan', 企业名称: '示例甲公司', 品牌语气: '专业', 状态: '初稿待复核' }]),
      table('tblvMcnwXhGoT4Ub', [{ 产品名称: '示例甲产品', 确认状态: '初稿待复核' }]),
      table('tblQ0kWrURJNGhre', [{ 画像名称: '示例甲客群', 痛点: '示例需求' }]),
      table('tbleP4LgzkcwAhiZ', [{ '抖音获客-关键词配置': '示例甲搜索', 是否启用: '是' }, { '抖音获客-关键词配置': '示例停用', 是否启用: '暂停' }]),
      table('tblzgMSK4KfgdE0r', [{ 手机Profile: 'jinoshengyuan-work', 账号名称: '示例甲账号', 抖音号: 'fixture-account-a', 绑定机器: 'fixture-machine-a' }]),
      table('tblZZWdv0YUNojqI', []),
    ] },
    yuesheng: { base: 'fixture-base-b', tables: [
      table('tblzWqEF6EJ5TKwh', [{ tenant_id: 'yueshengyun', 企业名称: '示例乙公司', 状态: '初稿待复核' }]),
      table('tbls6zMgujU2sY3Y', [{ 产品名称: '示例乙产品', 确认状态: '初稿待复核' }]),
      table('tbl7qoxG4m8Z30zw', [{ 画像名称: '示例乙客群', 痛点: '示例需求' }]),
      table('tblyKCp5vc7y2S40', [{ '抖音获客-关键词配置': '示例乙搜索', 是否启用: '启用' }]),
      table('tblg8QCFIIGkCVen', [{ 手机Profile: 'yueshengyun-work', 账号名称: '示例乙账号', 抖音号: 'fixture-account-b', 绑定机器: 'fixture-machine-b' }]),
      table('tblvf3t8ZWkOCpe1', []),
    ] },
  },
};
export const representativeDocs = [{ doc: 'fixture-company-doc', content: '# 示例乙公司\n仅用于CI的待复核资料，未访问外部平台。' }];
