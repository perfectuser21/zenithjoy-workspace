/**
 * 全宽独立页面（不渲染 sidebar / header / 内容区 padding）路由判定。
 * 抽出成纯函数便于单测；App.tsx 只负责消费判定结果。
 */
const FULL_BLEED_PATTERNS = [
  /^\/content-factory\/[^/]+\/output\/?$/,
  // Skill 评测上传 + 报告展示——下游报告是团队做的完整可视化页面（iframe 内嵌），
  // 挤在侧边栏旁边的窄内容区会被压缩，改成跟 content-factory 输出页同款全宽独立页面
  /^\/staff\/skill-eval\/?$/,
  /^\/staff\/skill-library\/?$/,
];

export function isFullBleedPath(pathname: string): boolean {
  return FULL_BLEED_PATTERNS.some((re) => re.test(pathname));
}
