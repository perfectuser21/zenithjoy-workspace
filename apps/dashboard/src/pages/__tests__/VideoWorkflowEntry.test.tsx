import { describe, expect, it } from 'vitest';
import { additionalRoutes } from '../../config/navigation.config';
import { AREA_HUBS } from '../AreaHubPage';

describe('视频工具入口', () => {
  it('移除旧画布入口并保留视频翻拍流水线', () => {
    expect(additionalRoutes.some(route => route.path.startsWith('/creative-canvas'))).toBe(false);
    expect(AREA_HUBS['video-tools'].cards.some(card => card.to.startsWith('/creative-canvas'))).toBe(false);
    expect(additionalRoutes.find(route => route.path === '/video-remake')).toMatchObject({
      component: 'VideoRemakePipelinePage',
      requireAuth: true,
    });
  });
});
