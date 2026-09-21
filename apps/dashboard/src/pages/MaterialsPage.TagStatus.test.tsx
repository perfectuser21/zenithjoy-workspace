import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Tile, Lightbox } from './MaterialsPage';
import type { Material } from '../api/materials.api';

/**
 * 素材识别状态可见化（GP line05/batch_mashup#step1）。
 *
 * 客户原话："我也不知道你把我的这个素材有没有 embedding，有没有打标签什么的，
 * 我都不清楚呀。" 而且只有 tag_status === 'tagged' 的素材才能进混剪选择页
 * （MashupPage taggedMaterials 过滤），所以看不到状态 = 不知道为什么选不到素材。
 *
 * 覆盖：
 *  ① 网格 Tile 三态徽章都用人话，不是裸英文枚举值。
 *  ② 详情弹窗 Lightbox 展示识别出的 ai_tags，让客户知道系统把素材理解成了什么。
 *  ③ Lightbox 未识别/失败态要让客户读懂"进不了混剪"。
 */
// 用图片 mime，避免触发 Lightbox 里视频那条现签预览的异步分支——
// 那条路径由 MaterialsPage.Lightbox.test.tsx 单独覆盖，这里只关心状态展示。
function baseMaterial(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-1',
    file_name: 'clip.jpg',
    size_bytes: 1024,
    mime_type: 'image/jpeg',
    taken_at: null,
    created_at: '2026-09-20T10:00:00.000Z',
    preview_url: 'https://img.example/p.jpg',
    tag_status: 'pending',
    ai_tags: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('MaterialsPage Tile — 识别状态徽章 [BEHAVIOR]', () => {
  it('tag_status=pending → 显示"待识别"，不是裸英文枚举值', () => {
    render(<Tile item={baseMaterial({ tag_status: 'pending' })} onOpen={vi.fn()} />);
    expect(screen.getByText('待识别')).toBeTruthy();
    expect(screen.queryByText('pending')).toBeNull();
  });

  it('tag_status=tagged → 显示"已识别"', () => {
    render(<Tile item={baseMaterial({ tag_status: 'tagged', ai_tags: ['开场', '产品特写'] })} onOpen={vi.fn()} />);
    expect(screen.getByText('已识别')).toBeTruthy();
    expect(screen.queryByText('tagged')).toBeNull();
  });

  it('tag_status=failed_pending_review → 显示"识别失败"，不是裸英文枚举值', () => {
    render(<Tile item={baseMaterial({ tag_status: 'failed_pending_review' })} onOpen={vi.fn()} />);
    expect(screen.getByText('识别失败')).toBeTruthy();
    expect(screen.queryByText('failed_pending_review')).toBeNull();
  });
});

describe('MaterialsPage Lightbox — 识别状态与标签展示 [BEHAVIOR]', () => {
  it('tag_status=tagged 且有 ai_tags → 展示识别出的标签', () => {
    render(
      <Lightbox
        item={baseMaterial({ tag_status: 'tagged', ai_tags: ['开场', '产品特写'] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('开场')).toBeTruthy();
    expect(screen.getByText('产品特写')).toBeTruthy();
  });

  it('tag_status=pending → 说人话解释"还没识别完，进不了混剪"，不是裸枚举值', () => {
    render(<Lightbox item={baseMaterial({ tag_status: 'pending' })} onClose={vi.fn()} />);
    expect(screen.queryByText('pending')).toBeNull();
    expect(screen.getByText(/混剪/)).toBeTruthy();
  });

  it('tag_status=failed_pending_review → 说人话解释识别失败、进不了混剪', () => {
    render(<Lightbox item={baseMaterial({ tag_status: 'failed_pending_review' })} onClose={vi.fn()} />);
    expect(screen.queryByText('failed_pending_review')).toBeNull();
    expect(screen.getAllByText(/识别失败/).length).toBeGreaterThan(0);
    expect(screen.getByText(/暂时进不了混剪/)).toBeTruthy();
  });
});
