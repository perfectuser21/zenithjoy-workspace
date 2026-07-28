import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PanelEventBus } from '../shared/panel-event-bus';
import { PanelEventsTail, panelEventsFilePath } from '../shared/panel-events-tail';

// PanelEventsTail 桥接 Python(listen_chat.py) 写的 panel-events.jsonl → TS 侧 PanelEventBus。
// 与 overlay_window.py 的 EventTailConsumer 同一类模式（file-tail 本地 IPC），
// 但读者换成 Agent 核心进程，供本地 SSE 转发给 WebView2 壳消费。
describe('PanelEventsTail', () => {
  let tmpDir: string;
  let bus: PanelEventBus;
  let tail: PanelEventsTail;

  afterEach(() => {
    tail?.stop();
    bus?.destroy();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupTmpStateDir() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-panel-tail-'));
    vi.stubEnv('ZJ_STATE_DIR', tmpDir);
    return tmpDir;
  }

  function appendEvent(evt: object) {
    fs.appendFileSync(panelEventsFilePath(), `${JSON.stringify(evt)}\n`, 'utf-8');
  }

  it('panelEventsFilePath 落在 ZJ_STATE_DIR 下的 panel-events.jsonl（不是 events.jsonl）', () => {
    setupTmpStateDir();
    expect(panelEventsFilePath()).toBe(path.join(tmpDir, 'panel-events.jsonl'));
  });

  it('start() 后轮询读到文件里已有的事件，ingest 进 bus', async () => {
    setupTmpStateDir();
    appendEvent({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'xian-pc', title: 'x', ts: Date.now(),
    });
    bus = new PanelEventBus();
    tail = new PanelEventsTail(bus, { pollMs: 50 });
    tail.start();
    await new Promise((r) => { setTimeout(r, 150); });
    expect(bus.getActiveTasks('line04')).toHaveLength(1);
  });

  it('新追加的行会在下一轮轮询被读到（不重复消费旧行）', async () => {
    setupTmpStateDir();
    appendEvent({
      event: 'task_started', task_id: 't1', line: 'line04', device: 'd', title: 'x', ts: Date.now(),
    });
    bus = new PanelEventBus();
    tail = new PanelEventsTail(bus, { pollMs: 30 });
    tail.start();
    await new Promise((r) => { setTimeout(r, 100); });
    expect(bus.getActiveTasks('line04')).toHaveLength(1);

    appendEvent({
      event: 'done', task_id: 't1', line: 'line04', device: 'd', title: 'x', ts: Date.now(),
    });
    await new Promise((r) => { setTimeout(r, 100); });
    expect(bus.getActiveTasks('line04')).toHaveLength(0);
    expect(bus.getRecentCompleted('line04')).toHaveLength(1);
  });

  it('坏行(非法JSON)跳过，不中断后续行消费', async () => {
    setupTmpStateDir();
    fs.appendFileSync(panelEventsFilePath(), '{{{ 坏行 not json\n', 'utf-8');
    appendEvent({
      event: 'task_started', task_id: 't2', line: 'line04', device: 'd', title: 'x', ts: Date.now(),
    });
    bus = new PanelEventBus();
    tail = new PanelEventsTail(bus, { pollMs: 30 });
    tail.start();
    await new Promise((r) => { setTimeout(r, 100); });
    expect(bus.getActiveTasks('line04')).toHaveLength(1);
  });

  it('文件尚不存在时不抛异常', async () => {
    setupTmpStateDir();
    bus = new PanelEventBus();
    tail = new PanelEventsTail(bus, { pollMs: 30 });
    expect(() => tail.start()).not.toThrow();
    await new Promise((r) => { setTimeout(r, 60); });
  });

  it('stop() 停止后不再消费新追加的行', async () => {
    setupTmpStateDir();
    bus = new PanelEventBus();
    tail = new PanelEventsTail(bus, { pollMs: 30 });
    tail.start();
    await new Promise((r) => { setTimeout(r, 60); });
    tail.stop();

    appendEvent({
      event: 'task_started', task_id: 't3', line: 'line04', device: 'd', title: 'x', ts: Date.now(),
    });
    await new Promise((r) => { setTimeout(r, 100); });
    expect(bus.getActiveTasks('line04')).toHaveLength(0);
  });
});
