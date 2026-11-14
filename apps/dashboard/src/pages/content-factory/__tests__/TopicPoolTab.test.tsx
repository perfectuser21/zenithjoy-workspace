import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TopicPoolTab from '../TopicPoolTab'
import * as topicsApi from '../../../api/topics.api'

vi.mock('../../../api/topics.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/topics.api')>()
  return {
    ...actual,
    listTopics: vi.fn(),
    createTopic: vi.fn(),
    updateTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getPacingConfig: vi.fn(),
    updatePacingConfig: vi.fn(),
    publishTopicNow: vi.fn(),
  }
})

const T1 = {
  id: 't1',
  title: '一人公司案例',
  angle: '成本结构',
  priority: 10,
  status: '已通过' as const,
  target_platforms: ['xiaohongshu', 'wechat'],
  scheduled_date: null,
  pipeline_id: null,
  created_at: '2026-04-15T00:00:00Z',
  updated_at: '2026-04-15T00:00:00Z',
  published_at: null,
  deleted_at: null,
}

const T2 = {
  ...T1,
  id: 't2',
  title: 'AI 提效',
  priority: 20,
  status: '待研究' as const,
  angle: null,
}

describe('TopicPoolTab', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(topicsApi.listTopics).mockResolvedValue({
      items: [T1, T2],
      total: 2,
      limit: 200,
      offset: 0,
    })
    vi.mocked(topicsApi.getPacingConfig).mockResolvedValue({ daily_limit: 1 })
  })

  it('loads and renders topics', async () => {
    render(<TopicPoolTab />)
    expect(await screen.findByText('一人公司案例')).toBeInTheDocument()
    expect(screen.getByText('AI 提效')).toBeInTheDocument()
    // 节奏默认 1
    expect(await screen.findByLabelText(/每日节奏：1/)).toBeInTheDocument()
  })

  it('shows empty state when no topics', async () => {
    vi.mocked(topicsApi.listTopics).mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    })
    render(<TopicPoolTab />)
    expect(await screen.findByText('选题池为空')).toBeInTheDocument()
  })

  it('shows error when API fails', async () => {
    vi.mocked(topicsApi.listTopics).mockRejectedValue(new Error('后端挂了'))
    render(<TopicPoolTab />)
    expect(await screen.findByText('后端挂了')).toBeInTheDocument()
  })

  it('creates a topic via form', async () => {
    vi.mocked(topicsApi.createTopic).mockResolvedValue({ ...T1, id: 't-new' })
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')

    fireEvent.click(screen.getByText('新增选题'))
    const titleInput = screen.getByPlaceholderText(/一人公司/)
    fireEvent.change(titleInput, { target: { value: '新选题' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(topicsApi.createTopic).toHaveBeenCalledWith(
        expect.objectContaining({ title: '新选题' })
      )
    })
  })

  it('validates empty title when creating', async () => {
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')

    fireEvent.click(screen.getByText('新增选题'))
    fireEvent.click(screen.getByText('保存'))
    expect(await screen.findByText('标题不能为空')).toBeInTheDocument()
    expect(topicsApi.createTopic).not.toHaveBeenCalled()
  })

  it('changes status via inline select', async () => {
    vi.mocked(topicsApi.updateTopic).mockResolvedValue({ ...T2, status: '已通过' })
    render(<TopicPoolTab />)
    await screen.findByText('AI 提效')

    const selects = screen.getAllByLabelText(/状态：/)
    // T2 是 '待研究'
    const t2Select = selects.find((el) => (el as HTMLSelectElement).value === '待研究')!
    fireEvent.change(t2Select, { target: { value: '已通过' } })

    await waitFor(() => {
      expect(topicsApi.updateTopic).toHaveBeenCalledWith(
        't2',
        expect.objectContaining({ status: '已通过' })
      )
    })
  })

  it('registers the task and waits for worker claim without marking topic researching', async () => {
    vi.mocked(topicsApi.publishTopicNow).mockResolvedValue({ id: 'pipeline-1', status: 'pending', cecelia_task_id: 'brain-task-1' })
    vi.mocked(topicsApi.updateTopic).mockResolvedValue({ ...T1, status: '研究中' })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')

    const buttons = screen.getAllByLabelText('立即发布')
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(topicsApi.publishTopicNow).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1' })
      )
    })
    expect(topicsApi.updateTopic).not.toHaveBeenCalled()
    expect(await screen.findByText('已登记任务，等待 Worker 认领')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('keeps topic unchanged when task registration fails', async () => {
    vi.mocked(topicsApi.publishTopicNow).mockRejectedValue(new Error('Brain 任务登记失败'))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')
    fireEvent.click(screen.getAllByLabelText('立即发布')[0])
    expect(await screen.findByText('Brain 任务登记失败')).toBeInTheDocument()
    expect(topicsApi.updateTopic).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('retries an unknown registration through the same topic button with the original run ID', async () => {
    const actual = await vi.importActual<typeof import('../../../api/topics.api')>('../../../api/topics.api')
    vi.mocked(topicsApi.publishTopicNow).mockImplementation(actual.publishTopicNow)
    const runId = '11111111-1111-4111-8111-111111111111'
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      calls.push(path)
      return path.endsWith('/trigger')
        ? {ok:false,json:async()=>({success:false,error:{message:'Brain 登记结果未知',details:{pipeline_run_id:runId,registration_status:'unknown'}}})}
        : {ok:true,json:async()=>({success:true,data:{id:runId,status:'pending',cecelia_task_id:'brain-task'}})}
    }))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')
    fireEvent.click(screen.getAllByLabelText('立即发布')[0])
    await screen.findByText(/Brain 登记结果未知/)
    fireEvent.click(screen.getByRole('button', {name:'重试挂号'}))
    expect(await screen.findByText('已登记任务，等待 Worker 认领')).toBeInTheDocument()
    expect(calls).toEqual(['/api/pipeline/trigger', `/api/pipeline/${runId}/register`])
    expect(topicsApi.updateTopic).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('does not attach a rejected registration to another topic or retry it as unknown', async () => {
    const actual = await vi.importActual<typeof import('../../../api/topics.api')>('../../../api/topics.api')
    vi.mocked(topicsApi.publishTopicNow).mockImplementation(actual.publishTopicNow)
    vi.stubGlobal('fetch', vi.fn(async () => ({ok:false,json:async()=>({success:false,error:{message:'Brain 拒绝任务',details:{pipeline_run_id:'11111111-1111-4111-8111-111111111111',registration_status:'rejected'}}})})))
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')
    fireEvent.click(screen.getAllByLabelText('立即发布')[0])
    expect(await screen.findByText(/登记已拒绝/)).toHaveTextContent('Brain 拒绝任务')
    expect(screen.queryByRole('button', {name:'重试挂号'})).not.toBeInTheDocument()
    expect(topicsApi.updateTopic).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it.each([
    ['running','已有任务正在执行'],
    ['completed','已有任务已完成，请在生产看板查看产出'],
    ['failed','已有任务失败，请在生产看板重跑'],
  ] as const)('shows an existing %s task with its actual status', async (status,message) => {
    vi.mocked(topicsApi.publishTopicNow).mockResolvedValue({id:'p1',status,cecelia_task_id:'brain-task'})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')
    fireEvent.click(screen.getAllByLabelText('立即发布')[0])
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('已登记任务，等待 Worker 认领')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {name:'已登记待认领'})).not.toBeInTheDocument()
    expect(topicsApi.updateTopic).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('delete asks for confirmation', async () => {
    vi.mocked(topicsApi.deleteTopic).mockResolvedValue({
      id: 't1',
      deleted: true,
      hard: false,
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')

    const buttons = screen.getAllByLabelText('删除选题')
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(topicsApi.deleteTopic).toHaveBeenCalledWith('t1')
    })

    confirmSpy.mockRestore()
  })

  it('skips delete when not confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')
    fireEvent.click(screen.getAllByLabelText('删除选题')[0])
    expect(topicsApi.deleteTopic).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('updates pacing daily_limit', async () => {
    vi.mocked(topicsApi.updatePacingConfig).mockResolvedValue({ daily_limit: 5 })

    render(<TopicPoolTab />)
    await screen.findByText('一人公司案例')

    // 点击数字进入编辑
    fireEvent.click(screen.getByLabelText(/每日节奏：1/))
    const input = screen.getByLabelText('daily_limit')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByLabelText('保存节奏'))

    await waitFor(() => {
      expect(topicsApi.updatePacingConfig).toHaveBeenCalledWith({ daily_limit: 5 })
    })
  })
})
