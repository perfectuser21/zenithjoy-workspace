import type { LineState, TaskSnapshot } from '@/shared/types';
import { toBusinessLabel } from '@/shared/line-labels';

function TaskCard({ task }: { task: TaskSnapshot }) {
  return (
    <div data-testid={`task-${task.task_id}`}>
      <div>{task.title}</div>
      {task.detail && <div>{task.detail}</div>}
      {task.progress && !task.detail && <div>第{task.progress[0]}/{task.progress[1]}步</div>}
    </div>
  );
}

function Lane({ line }: { line: LineState }) {
  const label = toBusinessLabel(line.line);
  const isEmpty = line.activeTasks.length === 0 && line.recentCompleted.length === 0;
  return (
    <div data-testid={`lane-${line.line}`}>
      <div>{label}</div>
      {!line.connected && <div>该业务线暂未接入实时看板</div>}
      {line.connected && isEmpty && <div>暂无任务记录，AI 开始工作后这里会实时显示</div>}
      {line.activeTasks.map((t) => <TaskCard key={t.task_id} task={t} />)}
      {line.recentCompleted.map((t) => <TaskCard key={t.task_id} task={t} />)}
    </div>
  );
}

// 展开态：真全屏，三条线横向泳道铺开，标题不截断（曾用340px窄栏被否决）。
export function ExpandedPanel({ lines }: { lines: LineState[] }) {
  return (
    <div data-testid="panel-expanded" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {lines.map((l) => <Lane key={l.line} line={l} />)}
    </div>
  );
}
