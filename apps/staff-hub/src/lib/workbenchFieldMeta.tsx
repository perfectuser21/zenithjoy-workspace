/**
 * 字段类型的视觉元数据 —— 让通用动态表看起来像 Notion，而不是一堆 `字段-text`。
 *
 * 每种 field_type 配：① 一枚 15px 线性图标（列头 + 详情面板用）② 一个中文标签。
 * 单选/多选的 option 走确定性哈希取一枚柔和标签色（同一个值永远同色，像 Notion 的 tag）。
 *
 * 这里只管"长什么样"，一个字节的写回语义都不碰（那些住在 WorkbenchRowGrid）。
 */
import type { ReactNode } from 'react';

export const FIELD_TYPE_LABEL: Record<string, string> = {
  text: '单行文本',
  long_text: '多行文本',
  number: '数字',
  date: '日期',
  single_select: '单选',
  multi_select: '多选',
  person: '人员',
  url: '链接',
  relation: '关联',
  rollup: '汇总',
  lookup: '查找',
};

export function fieldTypeLabel(type: string): string {
  return FIELD_TYPE_LABEL[type] ?? type;
}

/** 15px 线性图标，纯 currentColor，风格对齐 Notion 列头的克制小图标。 */
export function FieldIcon({ type, className }: { type: string; className?: string }): ReactNode {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `wb-field-icon${className ? ` ${className}` : ''}`,
    'aria-hidden': true,
  };
  switch (type) {
    case 'text':
      return (
        <svg {...common}>
          <path d="M4 7V5h16v2M9 19h6M12 5v14" />
        </svg>
      );
    case 'long_text':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 10h16M4 14h11M4 18h7" />
        </svg>
      );
    case 'number':
      return (
        <svg {...common}>
          <path d="M9 4 7 20M17 4l-2 16M5 9h15M4 15h15" />
        </svg>
      );
    case 'date':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
          <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
        </svg>
      );
    case 'single_select':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M9 12.3l2 2 4-4.6" />
        </svg>
      );
    case 'multi_select':
      return (
        <svg {...common}>
          <path d="M4 7h4v4H4zM4 15h4v4H4z" />
          <path d="M11 9h9M11 17h9" />
        </svg>
      );
    case 'person':
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case 'url':
      return (
        <svg {...common}>
          <path d="M9.5 14.5l5-5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
        </svg>
      );
    case 'relation':
      return (
        <svg {...common}>
          <path d="M4 8h11l-2.5-2.5M20 16H9l2.5 2.5" />
        </svg>
      );
    case 'rollup':
      return (
        <svg {...common}>
          <path d="M17 5H7l6 7-6 7h10" />
        </svg>
      );
    case 'lookup':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l4.5 4.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

/** Notion 风格的 9 色柔和标签盘（浅底深字），确定性取色，同值永远同色。 */
const TAG_PALETTE = [
  { bg: '#e3e2e0', fg: '#413f3a', dot: '#9b9a97' },
  { bg: '#e9e0d8', fg: '#5c4636', dot: '#a48a6f' },
  { bg: '#fbe4d0', fg: '#6b3f1c', dot: '#cf8a4d' },
  { bg: '#fbecca', fg: '#5c4318', dot: '#d0a83a' },
  { bg: '#dcecdb', fg: '#25402c', dot: '#5aa06a' },
  { bg: '#d3e5ef', fg: '#1f3d51', dot: '#4a91bf' },
  { bg: '#e6ddef', fg: '#402b57', dot: '#9271bd' },
  { bg: '#f4dde8', fg: '#54263c', dot: '#c069a1' },
  { bg: '#fbdcd8', fg: '#5a201c', dot: '#d76b62' },
] as const;

export interface TagColor {
  bg: string;
  fg: string;
  dot: string;
}

export function tagColor(value: string): TagColor {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

/** 人员字段的头像底色 + 首字，简单但比裸文本像样得多。 */
export function personBadge(name: string): { initial: string; color: TagColor } {
  const trimmed = name.trim();
  const initial = trimmed ? Array.from(trimmed)[0] : '?';
  return { initial, color: tagColor(trimmed || 'person') };
}
