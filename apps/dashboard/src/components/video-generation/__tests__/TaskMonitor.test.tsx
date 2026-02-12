import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskMonitor from '../TaskMonitor';
import type { VideoGenerationTask } from '../../../types/video-generation.types';

// Mock the API
vi.mock('../../../api/video-generation.api', () => ({
  pollTaskStatus: vi.fn((taskId, onProgress) => {
    // 立即返回模拟任务
    return Promise.resolve();
  }),
}));

describe('TaskMonitor', () => {
  const mockOnComplete = vi.fn();
  const mockOnError = vi.fn();

  it('应该显示排队中状态', () => {
    const mockTask: VideoGenerationTask = {
      id: 'task_123',
      object: 'generation.task',
      status: 'queued',
      progress: 0,
      created_at: 1234567890,
    };

    // 使用 pollTaskStatus mock 来模拟任务
    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation((taskId: string, onProgress: (task: VideoGenerationTask) => void) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    expect(screen.getByText('排队中')).toBeInTheDocument();
  });

  it('应该显示生成中状态和进度条', () => {
    const mockTask: VideoGenerationTask = {
      id: 'task_123',
      object: 'generation.task',
      status: 'in_progress',
      progress: 45,
      created_at: 1234567890,
    };

    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation((taskId: string, onProgress: (task: VideoGenerationTask) => void) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    expect(screen.getByText('生成中')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('生成进度')).toBeInTheDocument();
  });

  it('应该显示已完成状态', () => {
    const mockTask: VideoGenerationTask = {
      id: 'task_123',
      object: 'generation.task',
      status: 'completed',
      progress: 100,
      created_at: 1234567890,
      completed_at: 1234567990,
      result: {
        video_url: 'https://example.com/video.mp4',
        duration: 10,
        resolution: '1080p',
      },
    };

    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation((taskId: string, onProgress: (task: VideoGenerationTask) => void) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('应该显示失败状态和错误信息', () => {
    const mockTask: VideoGenerationTask = {
      id: 'task_123',
      object: 'generation.task',
      status: 'failed',
      progress: 50,
      created_at: 1234567890,
      error: {
        message: '生成失败：服务器错误',
      },
    };

    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation((taskId: string, onProgress: (task: VideoGenerationTask) => void) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('生成失败：服务器错误')).toBeInTheDocument();
  });

  it('应该对未知状态显示加载中（兜底）', () => {
    // 模拟一个未知状态的任务（虽然不应该发生，但要测试兜底逻辑）
    const mockTask = {
      id: 'task_123',
      object: 'generation.task',
      status: 'unknown_status' as any,
      progress: 0,
      created_at: 1234567890,
    };

    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation((taskId: string, onProgress: (task: any) => void) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    // 应该显示兜底状态"加载中"
    expect(screen.getByText('加载中')).toBeInTheDocument();
  });

  it('初始状态应该显示加载动画', () => {
    // 不立即调用 onProgress，模拟加载状态
    const { pollTaskStatus } = require('../../../api/video-generation.api');
    pollTaskStatus.mockImplementation(() => {
      return new Promise(() => {}); // 永不 resolve，保持加载状态
    });

    const { container } = render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    // 查找 spinner 动画
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
