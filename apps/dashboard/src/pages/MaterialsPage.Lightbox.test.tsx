import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Lightbox } from './MaterialsPage';
import type { Material } from '../api/materials.api';

const { getMaterialPreview } = vi.hoisted(() => ({ getMaterialPreview: vi.fn() }));
vi.mock('../api/materials.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/materials.api')>()),
  getMaterialPreview,
}));

/**
 * 素材视频在线预览 —— 决策 1a20f778 否掉的是"网格里每条都 ffmpeg 抽帧"，
 * 不是"点开播放"；后端 GET /materials/:id/preview 早就为播放写好了，前端没接。
 */
const VIDEO: Material = {
  id: 'mat-1', file_name: 'clip.mp4', size_bytes: 1024, mime_type: 'video/mp4',
  taken_at: null, created_at: '2026-09-20T10:00:00.000Z', preview_url: 'https://stale.example/old.mp4',
};

beforeEach(() => {
  getMaterialPreview.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('MaterialsPage Lightbox — 视频在线预览 [BEHAVIOR]', () => {
  it('打开视频弹窗渲染 <video controls>，src 来自现签地址而非列表里的旧地址', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/new.mp4', previewAvailable: true,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://fresh.example/new.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(getMaterialPreview).toHaveBeenCalledWith('mat-1');
  });

  it('后端说 previewAvailable=false 但签出了地址 → 仍然播（快捷指令传 octet-stream 的视频）', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/new.mov', previewAvailable: false,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={{ ...VIDEO, mime_type: 'application/octet-stream', file_name: 'clip.mov' }} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
  });

  it('签发失败（previewUrl 为 null）→ 占位文案，绝不把 null 塞进 src', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: null, previewAvailable: false, expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/预览地址签发失败/)).toBeTruthy());
    expect(document.querySelector('video')).toBeNull();
  });

  it('浏览器解不了这个编码 → onError 降级占位，不留黑屏', async () => {
    getMaterialPreview.mockResolvedValue({
      materialId: 'mat-1', previewUrl: 'https://fresh.example/weird.avi', previewAvailable: true,
      expiresAt: '2026-09-21T12:00:00.000Z',
    });

    render(<Lightbox item={VIDEO} onClose={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    await waitFor(() => expect(screen.getByText(/这个视频浏览器放不了/)).toBeTruthy());
  });

  it('图片素材不受影响，照旧渲染 <img>，不调预览接口', async () => {
    render(
      <Lightbox
        item={{ ...VIDEO, file_name: 'photo.jpg', mime_type: 'image/jpeg', preview_url: 'https://img.example/p.jpg' }}
        onClose={vi.fn()}
      />,
    );

    expect(document.querySelector('img')).toBeTruthy();
    expect(getMaterialPreview).not.toHaveBeenCalled();
  });
});
