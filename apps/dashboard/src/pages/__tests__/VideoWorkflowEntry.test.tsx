import { describe, expect, it } from 'vitest';
import { additionalRoutes } from '../../config/navigation.config';
import { AREA_HUBS } from '../AreaHubPage';

describe('ComfyUI视频创作默认入口', () => {
  it('默认进入原生ComfyUI，不以独立分步应用替代画布', () => {
    expect(additionalRoutes.find(route => route.path === '/creative-canvas')).toMatchObject({ component: 'CreativeCanvasPage', requireAuth: true, requireStaff: true });
    expect(additionalRoutes.find(route => route.path === '/creative-canvas/advanced')).toMatchObject({ component: 'CreativeCanvasPage', requireAuth: true, requireStaff: true });
  });
  it('视频工具卡片明确原生节点连线', () => {
    const card = AREA_HUBS['video-tools'].cards.find(item => item.to === '/creative-canvas');
    expect(card?.desc).toMatch(/节点/);
    expect(card?.desc).toMatch(/连线/);
  });
});
