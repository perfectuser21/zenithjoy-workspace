import { spawnSync } from 'node:child_process';
// 仅提取当前原树几何，不授权动作。截图仍须独立视觉复核；字段关联按最近唯一编辑框祖先。
export function resolvePddForm(xml, { width, height }) {
  const result = spawnSync('python3', [new URL('./pdd-form.py', import.meta.url).pathname], {
    input: JSON.stringify({ xml, width, height }), encoding: 'utf8', timeout: 5000, maxBuffer: 1_048_576,
  });
  if (result.error || result.status !== 0) return { status: 'unknown', requiresVisualReview: true, anchors: {}, reasons: ['UI_PARSER_UNAVAILABLE'] };
  return JSON.parse(result.stdout);
}
