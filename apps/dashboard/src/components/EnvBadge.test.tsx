import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EnvBadge, { resolveEnvFlag } from './EnvBadge';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe('resolveEnvFlag', () => {
  it('staging → 橙色 STAGING 旗', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'staging');
    const flag = resolveEnvFlag();
    expect(flag).toEqual({ text: 'STAGING', color: '#f97316' });
  });

  it('dev → 蓝色 DEV 旗', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'dev');
    expect(resolveEnvFlag()).toEqual({ text: 'DEV', color: '#3b82f6' });
  });

  it('大小写不敏感（STAGING 也认）', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'STAGING');
    expect(resolveEnvFlag()?.text).toBe('STAGING');
  });

  it('production → 不显示（null）', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'production');
    vi.stubEnv('DEV', false);
    expect(resolveEnvFlag()).toBeNull();
  });

  it('prod 简写 → 不显示', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'prod');
    vi.stubEnv('DEV', false);
    expect(resolveEnvFlag()).toBeNull();
  });

  it('未设 VITE_DEPLOY_ENV 且非 dev 构建 → 不显示（生产 build 保持干净）', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', '');
    vi.stubEnv('DEV', false);
    expect(resolveEnvFlag()).toBeNull();
  });

  it('未设 VITE_DEPLOY_ENV 但本地 vite dev → DEV 旗', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', '');
    vi.stubEnv('DEV', true);
    expect(resolveEnvFlag()?.text).toBe('DEV');
  });
});

describe('EnvBadge render', () => {
  it('staging 渲染出可见角标', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'staging');
    render(<EnvBadge />);
    expect(screen.getByTestId('env-badge')).toBeTruthy();
    expect(screen.getByText('STAGING')).toBeTruthy();
  });

  it('production 不渲染任何东西', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'production');
    vi.stubEnv('DEV', false);
    const { container } = render(<EnvBadge />);
    expect(screen.queryByTestId('env-badge')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('角标不挡交互（pointer-events:none）', () => {
    vi.stubEnv('VITE_DEPLOY_ENV', 'staging');
    render(<EnvBadge />);
    const badge = screen.getByTestId('env-badge') as HTMLElement;
    expect(badge.style.pointerEvents).toBe('none');
  });
});
