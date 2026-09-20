import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PhoneFrame from './PhoneFrame';

afterEach(cleanup);

describe('PhoneFrame', () => {
  it('把 children 渲染在屏幕区内，外框带灵动岛与侧键', () => {
    render(
      <PhoneFrame>
        <img alt="画面" src="/x.jpg" />
      </PhoneFrame>,
    );
    const frame = screen.getByTestId('phone-frame');
    const screenArea = screen.getByTestId('phone-screen');
    expect(frame).toContainElement(screenArea);
    expect(screenArea).toContainElement(screen.getByRole('img', { name: '画面' }));
    expect(screen.getByTestId('phone-island')).toBeInTheDocument();
    expect(frame.querySelectorAll('[data-testid="phone-side-button"]').length).toBeGreaterThanOrEqual(3);
  });

  it('屏幕区保持手机等比（9:19.5）且裁圆角', () => {
    render(<PhoneFrame>x</PhoneFrame>);
    const screenArea = screen.getByTestId('phone-screen');
    expect(screenArea.className).toMatch(/aspect-\[9\/19\.5\]/);
    expect(screenArea.className).toMatch(/overflow-hidden/);
    expect(screenArea.className).toMatch(/rounded-\[/);
  });

  it('外层 className 透传到外框', () => {
    render(<PhoneFrame className="lg:w-[360px]">x</PhoneFrame>);
    expect(screen.getByTestId('phone-frame').className).toContain('lg:w-[360px]');
  });
});
