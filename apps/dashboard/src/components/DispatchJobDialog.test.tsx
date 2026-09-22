import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DispatchJobDialog, { windowPresets } from './DispatchJobDialog';
import type { ScheduleDevice } from '../api/schedule.api';

const dispatchJob = vi.fn();
vi.mock('../api/schedule.api', async (orig) => ({
  ...(await orig<typeof import('../api/schedule.api')>()),
  dispatchJob: (...a: unknown[]) => dispatchJob(...a),
}));

afterEach(cleanup);
beforeEach(() => { dispatchJob.mockReset(); dispatchJob.mockResolvedValue({ id: 'new-1' }); });

const devices = [
  { agent_id: 'a1', name: '金诺工作机', serial: 'ANGYVB4227006983', online: true, depts: [], quotas: [], slots: [] },
  { agent_id: 'a2', name: '悦升工作机', serial: 'ANGYVB4402004137', online: false, depts: [], quotas: [], slots: [] },
] as unknown as ScheduleDevice[];

const open = (over = {}) =>
  render(<DispatchJobDialog devices={devices} defaultAgentId="a1" onClose={() => {}} onDone={() => {}} {...over} />);

/** 选中某件活 */
const pick = (label: string | RegExp) =>
  fireEvent.click(screen.getByText(label).closest('[data-testid="job-option"]')!);

describe('窗口语义：排的是窗口不是时刻', () => {
  it('碰平台的活，预设窗口一律不窄于 30 分钟（铁律 27bb6d1a）', () => {
    for (const p of windowPresets(true)) expect(p.minutes).toBeGreaterThanOrEqual(30);
  });

  it('不碰平台的活才给"就现在"', () => {
    expect(windowPresets(false).some((p) => p.minutes === 0)).toBe(true);
    expect(windowPresets(true).some((p) => p.minutes === 0)).toBe(false);
  });
});

describe('先列出这个部门有哪些活', () => {
  it('默认部门（智能获客）直接把可派的活列出来，带一句话说明', () => {
    open();
    const opts = screen.getAllByTestId('job-option');
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('按关键词采收线索')).toBeTruthy();
    expect(screen.getByText(/把搜到的视频下面的评论人收成线索/)).toBeTruthy();
  });

  it('没活的部门明说没有，而不是给一个空列表让人干瞪眼', () => {
    open();
    fireEvent.change(screen.getByLabelText('部门'), { target: { value: '视频剪辑' } });
    expect(screen.getByTestId('no-jobs')).toHaveTextContent(/还没有可派的活/);
    expect(screen.queryAllByTestId('job-option')).toHaveLength(0);
  });

  it('没选活之前不给派——两步式下这个按钮压根不出现（比禁用更彻底）', () => {
    // 旧版是"按钮在但禁用"。改两步后第一步只负责挑活，摆个灰按钮反而让人以为漏填了什么。
    open();
    expect(screen.queryByRole('button', { name: '派下去' })).toBeNull();
  });
});

describe('选中一件活之后，告诉我要填什么', () => {
  it('采收：出现关键词与条数两个框，条数带默认值', () => {
    open();
    pick('按关键词采收线索');
    expect(screen.getByLabelText('关键词')).toBeTruthy();
    expect((screen.getByLabelText('最多采几条视频') as HTMLInputElement).value).toBe('6');
  });

  it('每个框下面写清楚这东西是什么', () => {
    open();
    pick('按关键词采收线索');
    expect(screen.getByText(/就是你在抖音搜索框里会输入的那个词/)).toBeTruthy();
  });

  it('私信：出现"发给谁"和"发什么"，并说明用哪个号发不用你选', () => {
    open();
    pick('给指定的人发一条私信');
    expect(screen.getByLabelText('发给谁')).toBeTruthy();
    expect(screen.getByLabelText('发什么')).toBeTruthy();
    expect(screen.getByText(/用哪个号发由这台机器自己定/)).toBeTruthy();
  });

  it('不用填东西的活明说"直接派就行"', () => {
    open();
    pick('跑一轮触达');
    expect(screen.getByTestId('no-fields')).toHaveTextContent(/不用填什么/);
  });

  // 「换部门清空已填的值」这条意图搬到了下面的两步式用例
  // （'换部门要回到第一步，并把已选的活和值一并清掉'）：两步式下第二步没有部门下拉，
  // 换部门必须先返回第一步，那条走的才是真实路径。
});

describe('提交', () => {
  it('必填项空着时当场指出是哪个框，不等后端报错', async () => {
    open();
    pick('按关键词采收线索');
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请填「关键词」');
    expect(dispatchJob).not.toHaveBeenCalled();
  });

  it('数字框填了汉字要拦住', async () => {
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.change(screen.getByLabelText('最多采几条视频'), { target: { value: '六' } });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('要填数字');
  });

  it('派下去时带的是 job_type 与用户填的值，不带 adb 动作也不带 profile', async () => {
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(dispatchJob).toHaveBeenCalled());
    const arg = dispatchJob.mock.calls[0][0];
    expect(arg.params).toEqual({ job_type: 'harvest_keyword', keyword: 'AI训练师', max_videos: '6' });
    expect(arg.params.action).toBeUndefined();
    expect(arg.params.profile).toBeUndefined();
    expect(arg.title).toBe('按关键词采收线索 · AI训练师');
    expect(Date.parse(arg.window_end) - Date.parse(arg.window_start)).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it('后端的拒绝理由原样显示', async () => {
    dispatchJob.mockRejectedValueOnce(new Error('对外动作至少留 30 分钟窗口'));
    open();
    pick('跑一轮触达');
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/30 分钟窗口/);
  });

  it('提交中按钮禁用，防手抖连点派出两批', async () => {
    let release!: () => void;
    dispatchJob.mockImplementationOnce(() => new Promise((r) => { release = () => r({ id: 'x' }); }));
    open();
    pick('跑一轮触达');
    const btn = screen.getByRole('button', { name: '派下去' });
    fireEvent.click(btn);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    release();
  });

  it('派成功后回调通知页面刷新', async () => {
    const onDone = vi.fn();
    open({ onDone });
    pick('跑一轮触达');
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('设备', () => {
  it('默认选中当前那台；离线设备标出来', () => {
    open();
    expect((screen.getByLabelText('设备') as HTMLSelectElement).value).toBe('a1');
    expect(screen.getByRole('option', { name: /悦升工作机.*离线/ })).toBeTruthy();
  });

  it('没有设备时说明白，不给空下拉', () => {
    render(<DispatchJobDialog devices={[]} defaultAgentId={null} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/没有可派单的设备/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '派下去' })).toBeNull();
  });
});

/**
 * 两步式（decision c4f24a3d）
 *
 * 主理人原话：「所有的任务都挤到一起，都是一个面。你其实应该是让我选择，
 * 比如说我到底是哪一种任务，**然后才进入它的输入窗口**。」
 *
 * 之前的实现逻辑上分了层（选活 → 展开字段），但全在同一屏里从上往下堆，
 * 视觉上仍是一个面。这组用例守的就是"第一步看不见输入框"。
 */
describe('两步：先选活，选完才进入这件活的输入窗口', () => {
  it('第一步只让选，看不到任何输入框——这条就是"不是一个面"的证据', () => {
    open();
    expect(screen.getAllByTestId('job-option').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('关键词')).toBeNull();
    expect(screen.queryByLabelText('什么时候跑')).toBeNull();
    // 派下去按钮也不该出现在第一步——还没选活，没什么可派
    expect(screen.queryByRole('button', { name: '派下去' })).toBeNull();
  });

  it('点一件活才进入第二步，标题变成这件活，且只出现它自己的字段', () => {
    open();
    pick('按关键词采收线索');
    expect(screen.getByText('按关键词采收线索', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByLabelText('关键词')).toBeTruthy();
    expect(screen.getByLabelText('什么时候跑')).toBeTruthy();
    // 另一件活的字段不能串进来
    expect(screen.queryByLabelText('发给谁')).toBeNull();
    // 选活的列表已经退场——这才叫"进入"，不是在同一屏往下展开
    expect(screen.queryAllByTestId('job-option').length).toBe(0);
  });

  it('第二步不再摆设备和部门下拉，只留一行只读上下文', () => {
    // 这两个下拉正是"挤在一个面"的来源；要换设备就返回第一步。
    open();
    pick('按关键词采收线索');
    expect(screen.queryByLabelText('设备')).toBeNull();
    expect(screen.queryByLabelText('部门')).toBeNull();
    expect(screen.getByTestId('dispatch-context').textContent).toContain('金诺工作机');
  });

  it('能返回第一步重新挑', () => {
    open();
    pick('按关键词采收线索');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getAllByTestId('job-option').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('关键词')).toBeNull();
  });

  it('返回后重新点同一件活，刚才填到一半的值还在', () => {
    // 填了一半回去看一眼再回来，值没了会恼人。
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    pick('按关键词采收线索');
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('AI训练师');
  });

  it('返回后换一件活，绝不把上一件的输入带过去', () => {
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    pick('给指定的人发一条私信');
    expect((screen.getByLabelText('发给谁') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('发什么') as HTMLTextAreaElement).value).toBe('');
  });

  it('换部门要回到第一步，并把已选的活和值一并清掉', () => {
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.change(screen.getByLabelText('部门'), { target: { value: '智能新媒体' } });
    fireEvent.change(screen.getByLabelText('部门'), { target: { value: '智能获客' } });
    pick('按关键词采收线索');
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('');
  });

  it('后端拒绝时停在第二步，让人改了再试，不要打回去重填', async () => {
    dispatchJob.mockRejectedValue(new Error('窗口太窄：碰平台的活不得短于 30 分钟'));
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('窗口太窄'));
    expect(screen.getByLabelText('关键词')).toBeTruthy();
    expect((screen.getByLabelText('关键词') as HTMLInputElement).value).toBe('AI训练师');
  });

  it('提交中返回键禁用——半途退回会让"派下去"落在不确定的状态上', async () => {
    let release: (v: unknown) => void = () => {};
    dispatchJob.mockReturnValue(new Promise((r) => { release = r; }));
    open();
    pick('按关键词采收线索');
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'AI训练师' } });
    fireEvent.click(screen.getByRole('button', { name: '派下去' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '返回' })).toBeDisabled());
    release({ id: 'x' });
  });

  it('窗口语义的说明在第二步还在——改版不能把这条铁律弄丢', () => {
    open();
    pick('按关键词采收线索');
    expect(screen.getByText(/向平台自首/)).toBeTruthy();
  });
});
