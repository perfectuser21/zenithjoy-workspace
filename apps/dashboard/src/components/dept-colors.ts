/** 部门配色：甘特色块与图例共用（Brain task 42d9e1f8） */
import type { Dept } from '../api/schedule.api';

export const DEPT_BLOCK: Record<Dept, { bg: string; bar: string; text: string }> = {
  智能获客: { bg: 'bg-emerald-100', bar: 'bg-emerald-500', text: 'text-emerald-900' },
  新媒体部: { bg: 'bg-sky-100', bar: 'bg-sky-500', text: 'text-sky-900' },
  私域客服: { bg: 'bg-violet-100', bar: 'bg-violet-500', text: 'text-violet-900' },
  视频剪辑: { bg: 'bg-amber-100', bar: 'bg-amber-500', text: 'text-amber-900' },
};
