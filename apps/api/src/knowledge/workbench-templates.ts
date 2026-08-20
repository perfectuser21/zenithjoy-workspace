/**
 * 开箱模板 —— 空工作台上给员工的起点（合同 Step1 / 本地标签 A7）
 *
 * 为什么要它：非技术员工面对空白工作台不知道从哪下手，"新建表"按钮本身不解决问题。
 * 模板把"一张表长什么样"具象化成可以一键落地的字段集。
 *
 * 纪律：模板声明就是落库结果的**唯一真相**——一键建表后 db_fields 里的
 * (name, field_type, options, display_order) 有序元组集合必须与这里逐字相等，差一个字即 FAIL。
 * 所以模板里不写任何运行时才知道的值（无时间戳、无随机数、无 env）。
 */

export interface TemplateField {
  name: string;
  field_type: string;
  options: string[];
  display_order: number;
}

export interface WorkbenchTemplate {
  template_key: string;
  name: string;
  fields: TemplateField[];
}

/**
 * 合同下限 ≥2。两张覆盖最常见的两类用法：一类是"跟人打交道"（客户跟进），
 * 一类是"跟事打交道"（项目任务）——八类字段在两张模板里合起来都出现过，
 * 员工照着改比从零建更快。
 */
export const WORKBENCH_TEMPLATES: WorkbenchTemplate[] = [
  {
    template_key: 'customer_followup',
    name: '客户跟进表',
    fields: [
      { name: '客户名称', field_type: 'text', options: [], display_order: 0 },
      { name: '联系方式', field_type: 'text', options: [], display_order: 1 },
      { name: '意向程度', field_type: 'single_select', options: ['高', '中', '低'], display_order: 2 },
      { name: '负责人', field_type: 'person', options: [], display_order: 3 },
      { name: '下次跟进日期', field_type: 'date', options: [], display_order: 4 },
      { name: '备注', field_type: 'long_text', options: [], display_order: 5 },
    ],
  },
  {
    template_key: 'project_tasks',
    name: '项目任务表',
    fields: [
      { name: '任务名称', field_type: 'text', options: [], display_order: 0 },
      { name: '状态', field_type: 'single_select', options: ['未开始', '进行中', '已完成'], display_order: 1 },
      { name: '标签', field_type: 'multi_select', options: ['紧急', '重要', '日常'], display_order: 2 },
      { name: '执行人', field_type: 'person', options: [], display_order: 3 },
      { name: '截止日期', field_type: 'date', options: [], display_order: 4 },
      { name: '预估工时', field_type: 'number', options: [], display_order: 5 },
      { name: '参考链接', field_type: 'url', options: [], display_order: 6 },
    ],
  },
];

export function findTemplate(key: string): WorkbenchTemplate | undefined {
  return WORKBENCH_TEMPLATES.find((t) => t.template_key === key);
}
