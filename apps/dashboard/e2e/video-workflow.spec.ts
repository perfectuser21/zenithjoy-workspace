import { test, expect } from '@playwright/test';

// Browser interaction regression with a simulated API. Real media processing is
// verified independently by video-project-media.test.ts; no model call is made here.
test('分步制作：检查分镜、设置修改、审核和成片', async ({ page }) => {
  const source = { id: 'source-1', kind: 'video', name: '产品展示原片.mp4', url: '/test-media.mp4', duration: 45, width: 720, height: 1280 };
  let project: any = {
    id: 'project-1', name: '产品展示原片', sourceAssetId: source.id, source,
    status: 'review', confirmed: false,
    segments: [0, 1, 2, 3].map((index) => ({
      id: `segment-${index + 1}`, assetId: `clip-${index + 1}`, start: index * 11.25,
      end: (index + 1) * 11.25, videoUrl: '/test-media.mp4', approved: false, useOriginal: false,
    })),
  };
  let paidSubmissions = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    let result: unknown = {};
    if (url.pathname === '/api/video-tools/config') result = { wan: { configured: true }, uploads: { configured: true } };
    else if (url.pathname === '/api/video-tools/projects') result = { projects: [project] };
    else if (url.pathname.endsWith('/assemble')) { project = { ...project, status: 'completed', outputUrl: '/test-media.mp4' }; result = project; }
    else if (url.pathname.includes('/segments/')) {
      const id = url.pathname.split('/').pop();
      project = { ...project, segments: project.segments.map((segment: any) => segment.id === id ? { ...segment, ...body } : segment) };
      result = project;
    } else if (url.pathname === '/api/video-tools/projects/project-1') {
      if (route.request().method() === 'PATCH') project = { ...project, confirmed: true, status: 'editing' };
      result = project;
    } else if (url.pathname.endsWith('/jobs') && route.request().method() === 'POST') { paidSubmissions++; result = { id: 'job-1', status: 'pending' }; }
    await route.fulfill({ json: result });
  });
  await page.goto('/creative-canvas?project=project-1');
  await expect(page.getByRole('heading', { name: '把整条视频，一步步改好' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认分段，下一步' })).toBeVisible();
  await page.screenshot({ path: '/tmp/zenithjoy-video-workflow-segments.png', fullPage: true });
  await page.getByRole('button', { name: '确认分段，下一步' }).click();
  await expect(page.getByRole('heading', { name: '这一段怎么改？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '合成完整视频' })).toBeDisabled();
  expect(paidSubmissions).toBe(0);
  await page.screenshot({ path: '/tmp/zenithjoy-video-workflow-edit.png', fullPage: true });
});
