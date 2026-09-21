import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PhoneFrame from './PhoneFrame';

afterEach(cleanup);

describe('PhoneFrame', () => {
  it('把 children 渲染在屏幕区内，带灵动岛', () => {
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
  });

  it('不再是拟物手机模型：没有侧键，也没有金属渐变边', () => {
    // 主理人 0921：「感觉硬加了个壳上去了」——拟物重壳在浅色卡片界面里格格不入，
    // 收成单层深边。这条守住，免得以后又把壳加回来。
    const { container } = render(<PhoneFrame>x</PhoneFrame>);
    expect(container.querySelectorAll('[data-testid="phone-side-button"]')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/from-zinc|via-zinc|bg-gradient-to-br/);
  });

  it('屏幕区保持手机等比（9:19.5）且裁圆角', () => {
    render(<PhoneFrame>x</PhoneFrame>);
    const screenArea = screen.getByTestId('phone-screen');
    expect(screenArea.className).toMatch(/aspect-\[9\/19\.5\]/);
    expect(screenArea.className).toMatch(/overflow-hidden/);
    expect(screenArea.className).toMatch(/rounded-\[/);
  });

  it('屏幕区顶部叠 iOS 风格状态栏（时间 + 信号/WiFi/电量），盖住安卓状态栏', () => {
    render(<PhoneFrame>x</PhoneFrame>);
    const bar = screen.getByTestId('phone-statusbar');
    expect(screen.getByTestId('phone-screen')).toContainElement(bar);
    expect(bar).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(bar.querySelector('[data-testid="phone-status-icons"]')).not.toBeNull();
  });

  it('屏幕区底部叠 iOS 风格 Home 条，盖住被控机底部的输入法提示条（ADB Keyboard）', () => {
    render(<PhoneFrame>x</PhoneFrame>);
    const home = screen.getByTestId('phone-homebar');
    expect(screen.getByTestId('phone-screen')).toContainElement(home);
    expect(home.className).toMatch(/bottom-0/);
    expect(home.querySelector('span')).not.toBeNull();
  });

  it('外层 className 透传到外框', () => {
    render(<PhoneFrame className="lg:w-[360px]">x</PhoneFrame>);
    expect(screen.getByTestId('phone-frame').className).toContain('lg:w-[360px]');
  });
});
