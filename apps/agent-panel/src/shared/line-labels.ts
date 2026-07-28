// 客户视图业务语言映射 —— 与 services/agent/src/shared/panel-line-labels.ts 同款判定点。
// 两处各自独立小文件（不同运行时/构建管线，不共享打包），保持一致靠测试而非共享代码。
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
