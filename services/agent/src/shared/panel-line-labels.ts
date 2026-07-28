// 客户视图业务语言映射。桌面壳唯一的观众是客户，从第一天起就该说人话，
// 没有"技术模式"可切换——不是"客户视图脱敏"那个刀3加厚项(那个指隐藏设备序列号/task_id等敏感技术细节)，
// 单纯是label命名问题。PrepPRD 判定点。

const LINE_LABELS: Record<string, string> = {
  line02: '智能获客',
  line04: '智能回复',
  publish: '智能发布',
};

const FALLBACK_LABEL = '未接入的业务线';

export function toBusinessLabel(line: string): string {
  return LINE_LABELS[line] ?? FALLBACK_LABEL;
}

export function assertNoInternalLineCode(text: string): boolean {
  return !/line\d+/i.test(text);
}
