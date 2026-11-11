import { describe, expect, it } from 'vitest';
import { additionalRoutes } from '../../config/navigation.config';
import { AREA_HUBS } from '../AreaHubPage';

describe('视频创作默认入口', () => {
  it('默认进入业务步骤，高级入口单独保留ComfyUI', () => {
    expect(additionalRoutes.find(route => route.path === '/creative-canvas')).toMatchObject({ component: 'VideoWorkflowPage', requireAuth: true, requireStaff: true });
    expect(additionalRoutes.find(route => route.path === '/creative-canvas/advanced')).toMatchObject({ component: 'CreativeCanvasPage', requireAuth: true, requireStaff: true });
  });
  it('视频工具卡片说明上传、分段和成片', () => {
    const card = AREA_HUBS['video-tools'].cards.find(item => item.to === '/creative-canvas');
    expect(card?.desc).toMatch(/分段/);
    expect(card?.desc).toMatch(/成片/);
  });
});
