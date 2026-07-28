import { describe, it, expect } from 'vitest';
import type {
  LightState, TaskState, TaskSnapshot, LineState,
} from './types';

// types.ts 是纯类型声明，没有运行时行为——这里验证的是"类型形状能被正确构造使用"
// (TypeScript编译期检查是主要价值，运行时断言是这个前提的最小可验证代理)。
describe('shared/types（作战窗面板类型契约，与Agent侧panel-event-bus输出对齐）', () => {
  it('LightState 的4个合法取值都能赋值', () => {
    const states: LightState[] = ['work', 'wait', 'stuck', 'idle'];
    expect(states).toHaveLength(4);
  });

  it('TaskState 的5个合法取值都能赋值', () => {
    const states: TaskState[] = ['work', 'waiting', 'stuck', 'done', 'failed'];
    expect(states).toHaveLength(5);
  });

  it('TaskSnapshot 必填字段构造出合法对象，可选字段可省略', () => {
    const task: TaskSnapshot = {
      task_id: 't1', line: 'line04', device: 'xian-pc', title: '回复客户张三', state: 'work',
    };
    expect(task.detail).toBeUndefined();
    expect(task.progress).toBeUndefined();
  });

  it('TaskSnapshot 可选字段(detail/progress)能正常携带', () => {
    const task: TaskSnapshot = {
      task_id: 't1',
      line: 'line04',
      device: 'xian-pc',
      title: '回复客户张三',
      state: 'work',
      detail: '第2/5步',
      progress: [2, 5],
    };
    expect(task.progress).toEqual([2, 5]);
  });

  it('LineState.connected=false 表示未接入占位线（判定点：占位线不上收起态灯带）', () => {
    const line: LineState = {
      line: 'line02', connected: false, lightState: 'idle', activeTasks: [], recentCompleted: [],
    };
    expect(line.connected).toBe(false);
  });
});
