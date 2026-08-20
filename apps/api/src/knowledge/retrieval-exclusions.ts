/**
 * A35① 前向兼容锚 —— 路③ 结构化数据**不进**知识中枢的问答检索域
 *
 * 为什么现在就要这个文件：路① 的问答检索（Sprint 后续刀）会遍历知识域的物理表建索引。
 * 路③ 这五张表装的是各家企业的经营明细（客户名单、报价、进度），语义上不是"沉淀的经验"，
 * 检索域一旦把它们吞进去，① 跨企业问答会把明细当经验答出来 ② 用户填的表名/字段名/单元格
 * 正文会成为 LLM 的输入面，即合同「输入对抗面」里那条被本清单从源头断掉的注入路径。
 *
 * 用法：检索侧建索引/枚举表时先过一遍本清单，命中即跳过。清单是**物理表名**（不是别名、
 * 不是 service 名），因为检索侧枚举的就是 information_schema 里的物理表名。
 *
 * 改动纪律：删掉任何一个表名 = 把该表放进检索域，A35 守卫会当场报红（五个名字逐个删一遍
 * 是登记在案的变异 A35-drop-name，注入次数 5）。新增路③ 表时必须同步加进来。
 */
export const RETRIEVAL_EXCLUDED_TABLES: readonly string[] = [
  'db_tables',
  'db_fields',
  'db_rows',
  'db_view_prefs',
  'db_audit',
] as const;

/** 该物理表是否被排除在问答检索域之外 */
export function isRetrievalExcluded(tableName: string): boolean {
  return RETRIEVAL_EXCLUDED_TABLES.includes(tableName);
}
