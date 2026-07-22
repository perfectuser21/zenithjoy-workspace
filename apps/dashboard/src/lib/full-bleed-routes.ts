/**
 * 全宽独立页面（不渲染 sidebar / header / 内容区 padding）路由判定。
 * 抽出成纯函数便于单测；App.tsx 只负责消费判定结果。
 */
const FULL_BLEED_PATTERNS = [
  /^\/content-factory\/[^/]+\/output\/?$/,
];

export function isFullBleedPath(pathname: string): boolean {
  return FULL_BLEED_PATTERNS.some((re) => re.test(pathname));
}
