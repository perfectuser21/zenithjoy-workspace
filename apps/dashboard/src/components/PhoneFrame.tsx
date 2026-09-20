/**
 * PhoneFrame — 纯 CSS 手机外框：深色机身、圆角、顶部灵动岛、左右侧键；
 * children 渲染在 9:19.5 等比的屏幕区里（工作机实时画面用，主理人 0920 要求"一个 iPhone 的框"）。
 */
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

const SIDE_BUTTON = 'absolute w-[3px] bg-zinc-600 shadow-[inset_0_0_1px_rgba(255,255,255,.35)]';

export default function PhoneFrame({ children, className = '' }: Props) {
  return (
    <div data-testid="phone-frame" className={`relative w-full max-w-[360px] mx-auto lg:mx-0 ${className}`}>
      {/* 左：静音键 + 音量上/下；右：电源键（纯装饰） */}
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_BUTTON} -left-[3px] top-[13%] h-[3.5%] rounded-l`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_BUTTON} -left-[3px] top-[19%] h-[7%] rounded-l`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_BUTTON} -left-[3px] top-[27.5%] h-[7%] rounded-l`} />
      <span aria-hidden data-testid="phone-side-button" className={`${SIDE_BUTTON} -right-[3px] top-[21%] h-[11%] rounded-r`} />
      <div className="select-none rounded-[46px] bg-zinc-900 p-2.5 ring-1 ring-zinc-700 shadow-[0_24px_60px_rgba(0,0,0,.45),inset_0_0_0_2px_rgba(255,255,255,.06)]">
        <div data-testid="phone-screen" className="relative aspect-[9/19.5] overflow-hidden rounded-[36px] bg-black">
          {children}
          <div
            aria-hidden
            data-testid="phone-island"
            className="pointer-events-none absolute left-1/2 top-2.5 h-6 w-[34%] -translate-x-1/2 rounded-full bg-black ring-1 ring-zinc-800"
          />
        </div>
      </div>
    </div>
  );
}
