// 作战窗面板共用类型 —— 与 services/agent/src/shared/panel-event-bus.ts 的输出对齐
// （面板消费 Agent 本地 SSE 推来的快照，不自己算看门狗/灯态聚合，那是 Agent 侧职责）。

export type LightState = 'work' | 'wait' | 'stuck' | 'idle';
export type TaskState = 'work' | 'waiting' | 'stuck' | 'done' | 'failed';

export interface TaskSnapshot {
  task_id: string;
  line: string;
  device: string;
  title: string;
  detail?: string;
  progress?: [number, number];
  state: TaskState;
}

export interface LineState {
  line: string;
  /** false = 未接入占位（PrepPRD：占位线不上收起态灯带，只在展开态显示） */
  connected: boolean;
  lightState: LightState;
  activeTasks: TaskSnapshot[];
  recentCompleted: TaskSnapshot[];
}
