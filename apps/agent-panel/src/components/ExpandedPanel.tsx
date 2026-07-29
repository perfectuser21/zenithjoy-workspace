import type { LineState, TaskSnapshot } from '@/shared/types';
import { toBusinessLabel } from '@/shared/line-labels';

function TaskCard({ task }: { task: TaskSnapshot }) {
  return (
    <div data-testid={`task-${task.task_id}`} className="panel-task-card">
      <div className="panel-task-card__title">{task.title}</div>
      {task.detail && <div className="panel-task-card__detail">{task.detail}</div>}
      {task.progress && !task.detail && (
        <div className="panel-task-card__detail">第{task.progress[0]}/{task.progress[1]}步</div>
      )}
    </div>
  );
}

function Lane({ line }: { line: LineState }) {
  const label = toBusinessLabel(line.line);
  const isEmpty = line.activeTasks.length === 0 && line.recentCompleted.length === 0;
  return (
    <div data-testid={`lane-${line.line}`} className="panel-lane">
      <div className="panel-lane__title">{label}</div>
      {!line.connected && <div className="panel-lane__empty">该业务线暂未接入实时看板</div>}
      {line.connected && isEmpty && <div className="panel-lane__empty">暂无任务记录，AI 开始工作后这里会实时显示</div>}
      {line.activeTasks.map((t) => <TaskCard key={t.task_id} task={t} />)}
      {line.recentCompleted.map((t) => <TaskCard key={t.task_id} task={t} />)}
    </div>
  );
}

// 展开态：真全屏，三条线横向泳道铺开，标题不截断（曾用340px窄栏被否决）。
export function ExpandedPanel({ lines }: { lines: LineState[] }) {
  return (
    <div data-testid="panel-expanded" className="panel-expanded">
      {lines.map((l) => <Lane key={l.line} line={l} />)}
    </div>
  );
}
