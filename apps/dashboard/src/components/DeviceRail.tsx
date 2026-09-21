/**
 * 设备左栏（Brain task c297df37）
 *
 * 主理人：「手机框你改了，我也没觉得改得很好看。」
 * 根因不在边框细节，在体量：一块 600px 高的画面占着左边一整列，而它大部分时间是静止的。
 * 形态三选一里他挑了「缩小成小窗，下面补数据」——画面是配角，这台机今天干得怎么样才是主角。
 *
 * 画面点开能放大（遮罩、Esc 都能关；换设备自动关，免得对着上一台的画面）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Maximize2 } from 'lucide-react';
import { slotsOfDay, backlogCount, type ScheduleSlot } from '../api/schedule.api';

export interface DeviceRailProps {
  name: string;
  serial?: string;
  online: boolean;
  /** 详情页地址 */
  href: string;
  /** MJPEG 实时画面地址 */
  liveUrl: string;
  slots: ScheduleSlot[];
  dayOffset: number;
  runningText?: string;
  quotas?: { dept: string; used: number; cap: number; unit: string }[];
  /** 画面放大/收起时告诉外面一声（外面可据此暂停轮询之类） */
  onZoomChange?: (zoomed: boolean) => void;
}

function Stat({ label, value, tone = '' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <span className={`text-[13px] font-semibold tabular-nums ${tone || 'text-neutral-700'}`}>{value}</span>
    </div>
  );
}

export default function DeviceRail({
  name,
  serial,
  online,
  href,
  liveUrl,
  slots,
  dayOffset,
  runningText,
  quotas = [],
  onZoomChange,
}: DeviceRailProps) {
  const [zoomed, setZoomed] = useState(false);
  const today = slotsOfDay(slots, dayOffset);
  const done = today.filter((s) => s.status === 'done').length;
  const bad = today.filter((s) => s.status === 'failed').length;
  const left = backlogCount(today);

  const setZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomChange?.(next);
    },
    [onZoomChange],
  );

  // 换设备时收起放大，不然会盯着上一台的画面
  useEffect(() => {
    setZoomed(false);
  }, [liveUrl]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed, setZoom]);

  return (
    <div className="flex w-full shrink-0 flex-col lg:w-[176px]">
      <div data-testid="rail-head" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
        <span className="text-[13px] font-semibold text-neutral-900">{name}</span>
        {!online && <span className="text-[11px] text-neutral-400">离线</span>}
        <Link to={href} className="ml-auto text-[11px] text-sky-600 hover:underline">
          步骤流 →
        </Link>
        {serial && <span className="w-full text-[10px] tabular-nums text-neutral-300">{serial}</span>}
      </div>

      <button
        data-testid="rail-live"
        onClick={() => setZoom(true)}
        title="点击放大"
        className="group relative mx-auto w-[150px] overflow-hidden rounded-2xl bg-neutral-900 p-[3px] shadow-[0_6px_20px_-10px_rgba(15,23,42,.4)] ring-1 ring-neutral-900/10"
      >
        <span className="relative block aspect-[9/19.5] overflow-hidden rounded-[14px] bg-black">
          <img alt="实时画面" src={liveUrl} className="h-full w-full object-contain" />
          {/* 盖住被控安卓机自己的状态栏与输入法提示条 */}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[14px] bg-black" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[12px] bg-black" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
            <Maximize2 className="h-5 w-5 text-white" />
          </span>
        </span>
      </button>
      <span className="mt-1 text-center text-[10px] text-neutral-300">点击放大</span>

      <div data-testid="rail-stats" className="mt-3 border-t border-neutral-100 pt-2">
        <div className="pb-1 text-[11px] leading-snug">
          {runningText ? (
            <span className="text-amber-700">正在跑：{runningText}</span>
          ) : (
            <span className="text-neutral-400">空闲</span>
          )}
        </div>
        <Stat label="已完成" value={done} tone="text-emerald-600" />
        <Stat label="待跑" value={left} />
        {bad > 0 && <Stat label="失败" value={bad} tone="text-rose-600" />}
        {quotas.map((q) => (
          <Stat key={q.dept} label={`${q.dept}额度`} value={`${q.used}/${q.cap}${q.unit}`} />
        ))}
      </div>

      {zoomed && (
        <div data-testid="live-modal" className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <button
            data-testid="live-modal-backdrop"
            aria-label="关闭放大的画面"
            onClick={() => setZoom(false)}
            className="absolute inset-0 cursor-default bg-neutral-900/70 backdrop-blur-sm"
          />
          <div className="relative max-h-full w-[320px] overflow-hidden rounded-[28px] bg-neutral-900 p-[5px] shadow-2xl">
            <div className="relative aspect-[9/19.5] overflow-hidden rounded-[24px] bg-black">
              <img alt="实时画面（放大）" src={liveUrl} className="h-full w-full object-contain" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28px] bg-black" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[24px] bg-black" />
            </div>
          </div>
          <span className="absolute bottom-6 text-xs text-white/70">点任意处或按 Esc 关闭</span>
        </div>
      )}
    </div>
  );
}
