import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorksGalleryPage from '../WorksGalleryPage';

describe('WorksGalleryPage', () => {
  it('应该展示 33 张卡片', () => {
    render(<WorksGalleryPage />);

    // 标题应该显示 33 张
    expect(screen.getByText(/33 张 ChatGPT 风格卡片/)).toBeInTheDocument();

    // 检查是否有第一张卡片的标题
    expect(screen.getByText('别把存档当成学会')).toBeInTheDocument();
  });

  it('应该有标签筛选功能（认知/社交/效率）', () => {
    render(<WorksGalleryPage />);

    // 应该有三个标签按钮
    const 认知Button = screen.getByRole('button', { name: '认知' });
    const 社交Button = screen.getByRole('button', { name: '社交' });
    const 效率Button = screen.getByRole('button', { name: '效率' });

    expect(认知Button).toBeInTheDocument();
    expect(社交Button).toBeInTheDocument();
    expect(效率Button).toBeInTheDocument();
  });

  it('点击标签应该筛选卡片', async () => {
    render(<WorksGalleryPage />);

    // 点击"认知"标签
    const 认知Button = screen.getByRole('button', { name: '认知' });
    fireEvent.click(认知Button);

    // 等待筛选生效
    await waitFor(() => {
      // 应该显示筛选后的数量（不是 33）
      const countText = screen.queryByText(/33 张 ChatGPT 风格卡片/);
      expect(countText).not.toBeInTheDocument();
    });

    // 应该出现"清除"按钮
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
  });

  it('点击"清除"应该重置筛选', async () => {
    render(<WorksGalleryPage />);

    // 先筛选
    const 认知Button = screen.getByRole('button', { name: '认知' });
    fireEvent.click(认知Button);

    // 点击清除
    await waitFor(() => {
      const clearButton = screen.getByRole('button', { name: '清除' });
      fireEvent.click(clearButton);
    });

    // 应该恢复显示 33 张
    expect(screen.getByText(/33 张 ChatGPT 风格卡片/)).toBeInTheDocument();
  });

  it('点击卡片应该打开详情面板', async () => {
    render(<WorksGalleryPage />);

    // 点击第一张卡片（"别把存档当成学会"）
    const firstCard = screen.getByText('别把存档当成学会');
    fireEvent.click(firstCard);

    // 应该出现详情面板（包含完整正文）
    await waitFor(() => {
      expect(screen.getByText(/你的收藏夹里躺着几十篇干货/)).toBeInTheDocument();
    });
  });
});
