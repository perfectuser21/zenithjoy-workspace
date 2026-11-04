import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaskMonitor from '../TaskMonitor';
class FixtureEventSource {
  static CLOSED = 2;
  static instances: FixtureEventSource[] = [];
  readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) { FixtureEventSource.instances.push(this); }
  emit(status: string, error?: string) { act(() => this.onmessage?.({ data: JSON.stringify({ status, progress: 65, error }) } as MessageEvent)); }
}
const queued = { id: 'job-1', platform: 'toapi', model: 'veo3.1-fast', status: 'queued', progress: 0 };
beforeEach(() => { FixtureEventSource.instances.length = 0; vi.stubGlobal('EventSource', FixtureEventSource); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show() {
  const onComplete = vi.fn(), onError = vi.fn();
  const view = render(<TaskMonitor taskId="job-1" platform="toapi" onComplete={onComplete} onError={onError} />);
  await screen.findByText('排队中');
  return { ...view, onComplete, onError };
}
describe('TaskMonitor current fetch/SSE lifecycle', () => {
  it('uses actual task endpoint, renders progress and closes SSE on unmount', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(queued)));
    const view = await show();
    expect(fetch).toHaveBeenCalledWith('/api/ai-video/task/job-1');
    expect(FixtureEventSource.instances[0].url).toBe('/api/ai-video/task/job-1/sse');
    FixtureEventSource.instances[0].emit('in_progress');
    expect(screen.getByText('生成中')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
    view.unmount(); expect(FixtureEventSource.instances[0].close).toHaveBeenCalled();
  });
  it('completion fetches the final task with video URL before notifying the consumer', async () => {
    const completed = { ...queued, status: 'completed', progress: 100, videoUrl: 'fixture.mp4' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(queued)))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed)));
    const { onComplete, onError } = await show(); FixtureEventSource.instances[0].emit('completed');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(completed));
    expect(onError).not.toHaveBeenCalled(); expect(FixtureEventSource.instances[0].close).toHaveBeenCalled();
  });
  it('SSE failure reports actual error and closes the stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(queued)));
    const { onComplete, onError } = await show(); FixtureEventSource.instances[0].emit('failed', 'fixture failure');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'fixture failure' }));
    expect(onComplete).not.toHaveBeenCalled(); expect(FixtureEventSource.instances[0].close).toHaveBeenCalled();
  });
});
