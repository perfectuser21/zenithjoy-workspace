import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AiVideoGenerationPage from '../AiVideoGenerationPage';
import * as videoGenerationApi from '../../api/video-generation.api';

// Mock the API
vi.mock('../../api/video-generation.api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createVideoGeneration: vi.fn(),
    pollTaskStatus: vi.fn(),
  };
});

describe('AiVideoGenerationPage', () => {
  it('应该展示页面标题', () => {
    render(<AiVideoGenerationPage />);

    // 验证标题存在
    expect(screen.getByText('AI 视频生成')).toBeInTheDocument();
    expect(screen.getByText(/使用 AI 模型生成专业级视频内容/)).toBeInTheDocument();
  });

  it('应该有提示词输入框', () => {
    render(<AiVideoGenerationPage />);

    // 查找 textarea（提示词输入框）
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
  });

  it('应该有生成按钮', () => {
    render(<AiVideoGenerationPage />);

    // 查找生成按钮
    const generateButton = screen.getByRole('button', { name: /开始生成视频/ });
    expect(generateButton).toBeInTheDocument();
  });

  it('空提示词时按钮应该禁用', () => {
    render(<AiVideoGenerationPage />);

    // 找到生成按钮
    const generateButton = screen.getByRole('button', { name: /开始生成视频/ });

    // 按钮应该是禁用的（因为提示词为空）
    expect(generateButton).toBeDisabled();
  });

  it('输入提示词后按钮应该启用', () => {
    render(<AiVideoGenerationPage />);

    // 找到生成按钮（初始应该禁用）
    const generateButton = screen.getByRole('button', { name: /开始生成视频/ });
    expect(generateButton).toBeDisabled();

    // 输入提示词
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '测试提示词' } });

    // 按钮应该启用
    expect(generateButton).not.toBeDisabled();
  });
});
