import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcquisitionHubPage from '../AcquisitionHubPage';
afterEach(cleanup);
it('shows legacy retirement and keeps historical pages reachable', () => {
  render(<MemoryRouter><AcquisitionHubPage /></MemoryRouter>);
  for (const [name, destination] of [
    ['历史账号', '/area/acquisition/accounts'], ['历史采集任务', '/area/acquisition/tasks'],
    ['看线索', '/area/acquisition/leads'], ['触达记录', '/area/acquisition/outreach'],
  ]) expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', destination);
  expect(screen.getByText(/旧版获客已停用/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /下载安卓客户端|绑抖音小号/ })).not.toBeInTheDocument();
});
