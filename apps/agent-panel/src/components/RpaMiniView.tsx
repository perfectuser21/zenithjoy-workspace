import type { LineState } from '@/shared/types';
import { toBusinessLabel } from '@/shared/line-labels';

// 展开态+RPA进行中：不给全屏，退让对角贴边小窗，只读+鼠标穿透（宿主层实现WS_EX_TRANSPARENT，
// 这里只保证组件本身不渲染任何可交互元素）。异常态在这里天然可见，不设计额外升级机制。
export function RpaMiniView({ lines }: { lines: LineState[] }) {
  const connected = lines.filter((l) => l.connected);
  return (
    <div data-testid="panel-rpa-mini" className="panel-rpa-mini">
      <div className="panel-rpa-mini__header">🔒 RPA 进行中 · 贴边只读</div>
      {connected.map((l) => (
        <div key={l.line} data-testid={`mini-${l.line}`} data-state={l.lightState} className="panel-rpa-mini__line">
          {toBusinessLabel(l.line)}
          {l.activeTasks[0] && ` ${l.activeTasks[0].title}`}
        </div>
      ))}
    </div>
  );
}
