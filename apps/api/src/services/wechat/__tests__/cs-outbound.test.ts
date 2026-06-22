/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock pool，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * cs-outbound.ts 单测（mock pool）—— 关键人「上下线播报 + 失败告警」出站任务队列。
 *
 * 真值表/去重逻辑是环境无关纯逻辑，这里 mock zenithjoy.wechat_publish_task 的 pool.query
 * 全覆盖：
 *   - enqueueKeyContactBroadcast：OFF→ON online / ON→OFF offline / 无跳变 skip / 关键人未配 skip
 *     / 入库失败不抛（返回 skip+reason，不阻塞开关）
 *   - enqueueFailureAlert：首次入队 / 同 (关键人,原因) 去重 / 关键人未配不入
 *   - markOutboundReceipt：ok→auto_sent / fail→send_failed
 * 真机 UIA 发送是接缝（xian-rog 真验），不在本单测范围。
 */

const queryMock = vi.fn();
vi.mock('../../../db/connection', () => ({
  default: { query: (...args: any[]) => queryMock(...args) },
}));

import {
  enqueueKeyContactBroadcast,
  enqueueFailureAlert,
  markOutboundReceipt,
  ONLINE_TEXT,
  OFFLINE_TEXT,
} from '../cs-outbound';

const AGENT = '3755783c-33fd-483c-bc28-10be65c4872a';
const KEY = '关键人A';

beforeEach(() => {
  queryMock.mockReset();
});

describe('enqueueKeyContactBroadcast 开关跳变播报', () => {
  it('OFF→ON → online，入一条上线任务（content=ONLINE_TEXT, target=关键人）', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'task-1' }] });
    const r = await enqueueKeyContactBroadcast({
      prevOn: false, nextOn: true, keyContact: KEY, agentId: AGENT,
    });
    expect(r.action).toBe('online');
    expect(r.task_id).toBe('task-1');
    // INSERT 参数：content + target_friend_alias
    const params = queryMock.mock.calls[0][1];
    expect(params).toContain(ONLINE_TEXT);
    expect(params).toContain(KEY);
    expect(params).toContain(AGENT);
  });

  it('ON→OFF → offline，入一条下线任务（content=OFFLINE_TEXT）', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'task-2' }] });
    const r = await enqueueKeyContactBroadcast({
      prevOn: true, nextOn: false, keyContact: KEY, agentId: AGENT,
    });
    expect(r.action).toBe('offline');
    expect(queryMock.mock.calls[0][1]).toContain(OFFLINE_TEXT);
  });

  it('无跳变（prev==next）→ skip，不入库', async () => {
    const r = await enqueueKeyContactBroadcast({
      prevOn: true, nextOn: true, keyContact: KEY, agentId: AGENT,
    });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('no_change');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('关键人未配（空）→ skip，不入库不报错', async () => {
    const r = await enqueueKeyContactBroadcast({
      prevOn: false, nextOn: true, keyContact: '', agentId: AGENT,
    });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('key_contact_unconfigured');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('入库失败 → skip+enqueue_failed，不抛（不阻塞开关保存）', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const r = await enqueueKeyContactBroadcast({
      prevOn: false, nextOn: true, keyContact: KEY, agentId: AGENT,
    });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('enqueue_failed');
  });
});

describe('enqueueFailureAlert 失败告警 + 去重', () => {
  it('首次（窗口内无同告警）→ 入队，返回 task_id', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })          // 去重查询：无
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] }); // INSERT
    const r = await enqueueFailureAlert({ reason: 'send_failed', keyContact: KEY, agentId: AGENT });
    expect(r.task_id).toBe('alert-1');
    expect(r.deduped).toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('同 (关键人,原因) 窗口内已有 → 去重，不再 INSERT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // 去重查询：命中
    const r = await enqueueFailureAlert({ reason: 'send_failed', keyContact: KEY, agentId: AGENT });
    expect(r.deduped).toBe(true);
    expect(r.task_id).toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1); // 只查重，不 INSERT
  });

  it('关键人未配 → 不入队（无 DB 调用）', async () => {
    const r = await enqueueFailureAlert({ reason: 'send_failed', keyContact: '', agentId: AGENT });
    expect(r.task_id).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('markOutboundReceipt 回执', () => {
  it('ok=true → status 翻 auto_sent（UPDATE 命中）', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await markOutboundReceipt('task-1', true);
    expect(ok).toBe(true);
    expect(queryMock.mock.calls[0][1]).toContain('auto_sent');
  });

  it('ok=false → status 翻 send_failed', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await markOutboundReceipt('task-1', false);
    expect(ok).toBe(true);
    expect(queryMock.mock.calls[0][1]).toContain('send_failed');
  });

  it('任务不存在 / 已终态（rowCount=0）→ 返回 false', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 });
    const ok = await markOutboundReceipt('nope', true);
    expect(ok).toBe(false);
  });
});
