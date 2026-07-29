import type { LineState } from '@/shared/types';
import { lightStateColor } from '@/shared/light-state-color';

// 收起态：屏幕边缘细灯带。只为已接入(connected)的线上灯——
// 未接入占位线不上灯带（避免稀释信号，判定点：占位线只在展开态显示）。
export function CollapsedStrip({ lines, onClick }: { lines: LineState[]; onClick?: () => void }) {
  const connected = lines.filter((l) => l.connected);
  return (
    <div
      data-testid="panel-collapsed"
      className="panel-collapsed"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(); }}
    >
      {connected.map((l) => (
        <span
          key={l.line}
          data-testid={`lamp-${l.line}`}
          data-state={l.lightState}
          style={{ width: 6, height: 26, display: 'block', backgroundColor: lightStateColor(l.lightState) }}
        />
      ))}
    </div>
  );
}
