import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const adapter = vi.hoisted(() => ({ createVideoGeneration: vi.fn(), getTaskStatus: vi.fn(), name: 'fixture' }));
vi.mock('../platforms', () => ({ getPlatform: vi.fn(() => adapter), getAllPlatforms: vi.fn(), getPlatformIds: vi.fn() }));
import { createVideoGeneration, getTaskStatus, pollTaskStatus, uploadImage } from '../video-generation.api';
import { getPlatform } from '../platforms';
const task = (status: 'queued' | 'completed' | 'failed') => ({ id: 'job-1', platform: 'toapi', model: 'veo3.1-fast', status, progress: status === 'completed' ? 100 : 0 });
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('current video generation API orchestration', () => {
  it('selects the requested adapter and forwards original create parameters/result', async () => {
    const params = { platform: 'toapi', model: 'veo3.1-fast', prompt: 'fixture', duration: 8 };
    adapter.createVideoGeneration.mockResolvedValue(task('queued'));
    expect(await createVideoGeneration(params)).toEqual(task('queued'));
    expect(getPlatform).toHaveBeenCalledWith('toapi');
    expect(adapter.createVideoGeneration).toHaveBeenCalledWith(params);
  });
  it('status lookup uses both platform and task ID', async () => {
    adapter.getTaskStatus.mockResolvedValue(task('completed'));
    expect(await getTaskStatus('toapi', 'job-1')).toEqual(task('completed'));
    expect(getPlatform).toHaveBeenCalledWith('toapi');
    expect(adapter.getTaskStatus).toHaveBeenCalledWith('job-1');
  });
  it('polling reports progress and resolves at completed without polling again', async () => {
    vi.useFakeTimers();
    adapter.getTaskStatus.mockResolvedValueOnce(task('queued')).mockResolvedValueOnce(task('completed'));
    const progress = vi.fn();
    const result = pollTaskStatus('toapi', 'job-1', progress, 10, 100);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toEqual(task('completed'));
    await vi.advanceTimersByTimeAsync(100);
    expect(progress.mock.calls.map(([t]) => t.status)).toEqual(['queued', 'completed']);
    expect(adapter.getTaskStatus).toHaveBeenCalledTimes(2);
  });
  it('a failed task propagates its error and stops', async () => {
    adapter.getTaskStatus.mockResolvedValue({ ...task('failed'), error: { message: 'encoder failed' } });
    await expect(pollTaskStatus('toapi', 'job-1', vi.fn())).rejects.toThrow('encoder failed');
    expect(adapter.getTaskStatus).toHaveBeenCalledOnce();
  });
  it('polling timeout rejects instead of staying pending', async () => {
    vi.useFakeTimers(); adapter.getTaskStatus.mockResolvedValue(task('queued'));
    const result = pollTaskStatus('toapi', 'job-1', vi.fn(), 10, 5);
    const assertion = expect(result).rejects.toThrow('Task timeout');
    await vi.advanceTimersByTimeAsync(10); await assertion;
    expect(adapter.getTaskStatus).toHaveBeenCalledOnce();
  });
  it('uploads file bytes through the current backend endpoint and propagates HTTP failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ url: 'fixture-image' })))
      .mockResolvedValueOnce(new Response('{}', { status: 503, statusText: 'Unavailable' }));
    expect(await uploadImage(new File(['abc'], 'frame.png', { type: 'image/png' }))).toEqual({ url: 'fixture-image' });
    expect(fetch.mock.calls[0][0]).toBe('/api/upload-video-frame');
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({ base64: 'YWJj', filename: 'frame.png', size: 3 });
    await expect(uploadImage(new File(['abc'], 'frame.png'))).rejects.toThrow('Upload failed');
  });
});
