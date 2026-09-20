/**
 * PhoneFrame — iPhone Pro 风格外框（纯 Tailwind，无图片）：
 * 钛色金属边 + 内黑边、屏幕圆角按 393pt 机型比例（46/336≈0.137×屏宽）、灵动岛 32% 宽、钛色侧键；
 * 屏幕区顶部叠一条 iOS 风格状态栏（时间 + 信号/WiFi/电量），上 32px 纯黑盖住被控安卓机自己的状态栏
 *（USB 调试图标那行，1200×2664 机型约 100px ≈ 27px），32–48px 渐变透明不吃 App 顶栏；底部 Home 条盖住输入法提示条。
 * children 渲染在 9:19.5 等比的屏幕区里（工作机实时画面用）。
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

/** 钛色侧键：静音/音量上/音量下在左，电源在右 */
const SIDE_KEY = 'absolute w-[3px] rounded-sm bg-gradient-to-b from-zinc-300 via-zinc-500 to-zinc-400 shadow-[0_0_1px_rgba(0,0,0,.6)]';

function StatusIcons() {
  return (
    <span data-testid="phone-status-icons" className="flex items-center gap-[5px]">
      {/* 信号 */}
      <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden>
        <rect x="0" y="7" width="3" height="4" rx="0.8" fill="currentColor" />
        <rect x="4.6" y="5" width="3" height="6" rx="0.8" fill="currentColor" />
        <rect x="9.2" y="2.5" width="3" height="8.5" rx="0.8" fill="currentColor" />
        <rect x="13.8" y="0" width="3" height="11" rx="0.8" fill="currentColor" />
      </svg>
      {/* WiFi */}
      <svg width="16" height="11" viewBox="0 0 16 11" aria-hidden fill="currentColor">
        <path d="M8 10.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" />
        <path d="M4.2 6.2a5.4 5.4 0 0 1 7.6 0l-1.2 1.2a3.7 3.7 0 0 0-5.2 0L4.2 6.2Z" />
        <path d="M1.3 3.3a9.5 9.5 0 0 1 13.4 0l-1.2 1.2a7.8 7.8 0 0 0-11 0L1.3 3.3Z" />
      </svg>
      {/* 电量 */}
      <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
        <rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="currentColor" strokeOpacity="0.45" fill="none" />
        <rect x="2" y="2" width="17" height="8" rx="1.6" fill="currentColor" />
        <path d="M24 4v4a2 2 0 0 0 0-4Z" fill="currentColor" fillOpacity="0.5" />
      </svg>
    </span>
  );
}

export default function PhoneFrame({ children, className = '' }: Props) {
  const clock = useClock();
  return (
    <div data-testid="phone-frame" className={`relative w-full max-w-[360px] mx-auto lg:mx-0 ${className}`}>
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_KEY} -left-[2px] top-[15%] h-[3%]`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_KEY} -left-[2px] top-[21.5%] h-[6.5%]`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_KEY} -left-[2px] top-[29.5%] h-[6.5%]`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_KEY} -right-[2px] top-[24%] h-[10%]`} />
      {/* 钛色金属边 */}
      <div className="select-none rounded-[58px] p-[5px] bg-gradient-to-br from-zinc-100 via-zinc-400 to-zinc-300 shadow-[0_30px_70px_rgba(0,0,0,.45),0_0_0_1px_rgba(0,0,0,.35)]">
        {/* 内黑边 */}
        <div className="rounded-[53px] bg-black p-[7px]">
          <div data-testid="phone-screen" className="relative aspect-[9/19.5] overflow-hidden rounded-[46px] bg-black">
            {children}
            {/* iOS 风格状态栏：盖住安卓状态栏；灵动岛在其上层 */}
            <div
              aria-hidden
              data-testid="phone-statusbar"
              className="pointer-events-none absolute inset-x-0 top-0 flex h-[48px] items-start bg-[linear-gradient(to_bottom,#000_0,#000_32px,transparent_48px)] text-white"
            >
              <div className="mt-[8px] flex h-[38px] w-full items-center justify-between px-[26px] text-[15px] font-semibold tracking-tight">
                <span>{clock}</span>
                <StatusIcons />
              </div>
            </div>
            {/* iOS 风格 Home 条：盖住被控机底部导航区（AdbIME 的「ADB Keyboard {ON}」提示条就在这里） */}
            <div
              aria-hidden
              data-testid="phone-homebar"
              className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[34px] items-end justify-center bg-black pb-[8px]"
            >
              <span className="h-[5px] w-[36%] rounded-full bg-white/90" />
            </div>
            <div
              aria-hidden
              data-testid="phone-island"
              className="pointer-events-none absolute left-1/2 top-[10px] h-[34px] w-[32%] -translate-x-1/2 rounded-full bg-black"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
