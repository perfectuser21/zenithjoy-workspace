/**
 * PhoneFrame — 一块嵌进页面的屏幕（纯 Tailwind，无图片）
 *
 * 主理人 0921：「左边的那个手机也不好看，感觉硬加了个壳上去了。」
 * 上一版是拟物手机模型：钛色金属渐变边 + 侧键 + 厚重投影。那套东西在浅色卡片界面里
 * 自成一体，看着像贴了张贴纸。这版收成单层深边 + 柔和阴影 + 大圆角，让它读起来是
 * 「这台机现在的画面」，不是「一部手机的照片」。
 *
 * 状态栏遮盖与 Home 条保留，这两条是功能不是装饰：
 *   - 顶部纯黑盖住被控安卓机自己的状态栏（USB 调试图标那行）
 *   - 底部盖住 AdbIME 的「ADB Keyboard {ON}」提示条
 * children 渲染在 9:19.5 等比的屏幕区里。
 */
import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

const CLOCK_TICK_MS = 30_000;

function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function useClock(): string {
  const [text, setText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setText(formatClock(new Date())), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return text;
}

function StatusIcons() {
  return (
    <span data-testid="phone-status-icons" className="flex items-center gap-[5px]">
      <svg width="16" height="10" viewBox="0 0 17 11" aria-hidden>
        <rect x="0" y="7" width="3" height="4" rx="0.8" fill="currentColor" />
        <rect x="4.6" y="5" width="3" height="6" rx="0.8" fill="currentColor" />
        <rect x="9.2" y="2.5" width="3" height="8.5" rx="0.8" fill="currentColor" />
        <rect x="13.8" y="0" width="3" height="11" rx="0.8" fill="currentColor" />
      </svg>
      <svg width="15" height="10" viewBox="0 0 16 11" aria-hidden fill="currentColor">
        <path d="M8 10.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
        <path d="M4.2 6.2a5.4 5.4 0 0 1 7.6 0l-1.2 1.2a3.7 3.7 0 0 0-5.2 0L4.2 6.2Z" />
        <path d="M1.3 3.3a9.5 9.5 0 0 1 13.4 0l-1.2 1.2a7.8 7.8 0 0 0-11 0L1.3 3.3Z" />
      </svg>
      <svg width="24" height="11" viewBox="0 0 26 12" aria-hidden>
        <rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="currentColor" strokeOpacity="0.4" fill="none" />
        <rect x="2" y="2" width="17" height="8" rx="1.6" fill="currentColor" />
        <path d="M24 4v4a2 2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.5" />
      </svg>
    </span>
  );
}

export default function PhoneFrame({ children, className = '' }: Props) {
  const clock = useClock();
  return (
    <div data-testid="phone-frame" className={`relative mx-auto w-full max-w-[300px] lg:mx-0 ${className}`}>
      {/* 单层深边：薄到只起收边作用，不抢画面 */}
      <div className="select-none rounded-[30px] bg-neutral-900 p-[5px] shadow-[0_10px_30px_-12px_rgba(15,23,42,.45)] ring-1 ring-neutral-900/10">
        <div data-testid="phone-screen" className="relative aspect-[9/19.5] overflow-hidden rounded-[25px] bg-black">
          {children}
          <div
            aria-hidden
            data-testid="phone-statusbar"
            className="pointer-events-none absolute inset-x-0 top-0 flex h-[44px] items-start bg-[linear-gradient(to_bottom,#000_0,#000_28px,transparent_44px)] text-white"
          >
            <div className="mt-[6px] flex h-[34px] w-full items-center justify-between px-[20px] text-[13px] font-semibold tracking-tight">
              <span className="tabular-nums">{clock}</span>
              <StatusIcons />
            </div>
          </div>
          <div
            aria-hidden
            data-testid="phone-homebar"
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[28px] items-end justify-center bg-black pb-[7px]"
          >
            <span className="h-[4px] w-[34%] rounded-full bg-white/85" />
          </div>
          <div
            aria-hidden
            data-testid="phone-island"
            className="pointer-events-none absolute left-1/2 top-[8px] h-[26px] w-[30%] -translate-x-1/2 rounded-full bg-black"
          />
        </div>
      </div>
    </div>
  );
}
