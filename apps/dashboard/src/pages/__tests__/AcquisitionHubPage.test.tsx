import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AcquisitionHubPage from '../AcquisitionHubPage';
afterEach(cleanup);
it('renders current acquisition workflow navigation as usable links', () => {
  render(<MemoryRouter><AcquisitionHubPage /></MemoryRouter>);
  for (const [name, destination] of [
    ['绑抖音小号', '/area/acquisition/accounts'], ['采集', '/area/acquisition/tasks'],
    ['看线索', '/area/acquisition/leads'], ['触达记录', '/area/acquisition/outreach'],
  ]) expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', destination);
  expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('href', '/dashboard/acquisition-config');
  expect(screen.queryByText('即将上线')).not.toBeInTheDocument();
});
