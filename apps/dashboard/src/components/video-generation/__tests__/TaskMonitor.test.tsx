import { describe, it } from 'vitest';

/**
 * TaskMonitor Component Tests
 * TODO: Update for UnifiedTask and platform parameter (Step 6)
 *
 * Old tests removed - TaskMonitor now uses UnifiedTask type and platform parameter
 */

describe('TaskMonitor', () => {
  it.todo('should display task with platform and model info');
  it.todo('should poll with platform parameter');
  it.todo('should show progress bar for in_progress tasks');
  it.todo('should handle completed state');
  it.todo('should handle failed state with error message');
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

    mockPollTaskStatus.mockImplementation((_, onProgress: (task: VideoGenerationTask) => void) => {
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

    mockPollTaskStatus.mockImplementation((_, onProgress: (task: VideoGenerationTask) => void) => {
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
      status: 'unknown_status',
      progress: 0,
      created_at: 1234567890,
    };

    mockPollTaskStatus.mockImplementation((_, onProgress) => {
      onProgress(mockTask);
      return Promise.resolve(mockTask);
    });

    render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    // 应该显示兜底状态"加载中"
    expect(screen.getByText('加载中')).toBeInTheDocument();
  });

  it('初始状态应该显示加载动画', () => {
    mockPollTaskStatus.mockImplementation(() => {
      return new Promise(() => {}); // 永不 resolve，保持加载状态
    });

    const { container } = render(<TaskMonitor taskId="task_123" onComplete={mockOnComplete} onError={mockOnError} />);

    // 查找 spinner 动画
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
