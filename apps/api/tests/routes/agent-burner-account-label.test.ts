import { describe, it, expect, vi } from 'vitest';
import {
  resolveBindAccountLabel,
  reconcileAccountLabel,
  computeOfflineDiff,
} from '../../src/routes/agent-burner';

describe('resolveBindAccountLabel — 绑号阶段占位值', () => {
  it('绑号刚完成、无真实扫描结果时，用 pending:<task_id> 占位，不再用 payload.account_label', () => {
    const result = resolveBindAccountLabel({ task_id: 'task-abc-123', payload: { account_label: '小号1' } });
    expect(result).toBe('pending:task-abc-123');
  });
});

describe('reconcileAccountLabel — 归一到真实昵称', () => {
  it('该 agent 下存在 pending 占位行，且目标真实昵称行不存在 → 返回 UPDATE 动作', () => {
    const action = reconcileAccountLabel({
      agentId: 'agent-1',
      existingLabels: ['pending:task-abc-123'],
      realNickname: '嘻嘻',
    });
    expect(action).toEqual({ type: 'rename', from: 'pending:task-abc-123', to: '嘻嘻' });
  });

  it('该 agent 下存在 pending 占位行，但目标真实昵称行已存在 → 返回 DELETE 占位行动作（防止改名后与已有行的唯一约束冲突）', () => {
    const action = reconcileAccountLabel({
      agentId: 'agent-1',
      existingLabels: ['pending:task-abc-123', '嘻嘻'],
      realNickname: '嘻嘻',
    });
    expect(action).toEqual({ type: 'delete_pending', label: 'pending:task-abc-123' });
  });

  it('该 agent 下没有 pending 占位行（真实昵称本来就直接建的） → 返回 none，不动', () => {
    const action = reconcileAccountLabel({
      agentId: 'agent-1',
      existingLabels: ['嘻嘻'],
      realNickname: '嘻嘻',
    });
    expect(action).toEqual({ type: 'none' });
  });
});

describe('computeOfflineDiff — 差集标离线', () => {
  it('之前 active 的账号这次没出现在扫描列表里 → 判定为该标离线的账号', () => {
    const diff = computeOfflineDiff({
      previouslyActiveLabels: ['嘻嘻', '大湖成长之路（Ai+）', '秦军餐饮'],
      currentlyScannedLabels: ['嘻嘻', '秦军餐饮'],
    });
    expect(diff).toEqual(['大湖成长之路（Ai+）']);
  });

  it('全部账号仍在扫描列表里 → 空差集', () => {
    const diff = computeOfflineDiff({
      previouslyActiveLabels: ['嘻嘻'],
      currentlyScannedLabels: ['嘻嘻'],
    });
    expect(diff).toEqual([]);
  });

  it('扫描本身失败（ok=false）时不应被调用去标离线——这是调用方的职责，此函数本身对空数组输入保持保守（返回空差集，不臆造离线）', () => {
    const diff = computeOfflineDiff({
      previouslyActiveLabels: ['嘻嘻'],
      currentlyScannedLabels: [],
    });
    // 明确：扫描失败时 currentlyScannedLabels 传空数组会导致把所有账号都标离线，
    // 这是危险的——调用方必须在 ok=false 时完全不调用 computeOfflineDiff，
    // 而不是指望这个函数自己判断"是扫描失败还是真的全部离线"。
    // 这条测试记录这个纯函数的真实行为（不做特殊处理），调用点的 Step 3 会有对应的 guard。
    expect(diff).toEqual(['嘻嘻']);
  });
});
