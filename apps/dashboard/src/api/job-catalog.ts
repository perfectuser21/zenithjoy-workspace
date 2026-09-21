/**
 * 工作目录 —— 「这个部门有哪些活可以派，每件活要填什么」（task 3abb7f8c）
 *
 * 主理人的原话：「你应该给我列出来，不同部门有哪些工作。列出来之后我去点它，
 * 你应该让我输入某些关键词——针对这个工作流的输入到底有哪些。」
 *
 * 所以这里是**业务语言**的活，不是 adb 原语（搜词/打开 App/截屏那种工程师视角）。
 *
 * 两条自律：
 *  1. **只列真能跑的**。工作机上没有对应执行脚本的活一律不列 —— 列了就是给一个
 *     点了必然失败的菜单。某个部门在这台机器上没有活，就明说没有。
 *  2. **执行细节不进这里**。调哪个脚本、参数怎么排、用哪个账号发，都是工作机本地
 *     的事（领单器按 job_type 分派）。中台只描述「有哪些活、要填什么」。
 *     这条是上一轮 profile 事故的教训：中台猜工作机的本地概念，必然猜错。
 */
import type { Dept } from './schedule.api';

export type JobFieldType = 'text' | 'number' | 'textarea';

export interface JobField {
  name: string;
  label: string;
  type: JobFieldType;
  required: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  /** 填这个框时该知道的事，显示在输入框下面 */
  help?: string;
}

export interface JobDef {
  /** 领单器按这个分派到本地脚本 */
  id: string;
  dept: Dept;
  /** 业务语言的活名，主理人看的就是这个 */
  label: string;
  /** 一句话说明「派下去会发生什么」 */
  summary: string;
  fields: JobField[];
  /**
   * 是否碰平台。碰平台的活受窗口约束（铁律 27bb6d1a：固定整点发送＝向平台自首），
   * 不碰的可以精确到分。
   */
  outbound: boolean;
  /** 预计耗时，用于排布时间线 */
  estMinutes: number;
}

/**
 * 工作机（安卓真机）上真能跑的活。
 *
 * 目前只有智能获客一条线：采收与触达的脚本在工作机的 ~/bin-harvest 下。
 * 新媒体部的发布走 APK 那条链、视频剪辑在别的机器上，都不从这里派——
 * 等它们接进来再加，不提前画饼。
 */
export const JOB_CATALOG: JobDef[] = [
  {
    id: 'harvest_keyword',
    dept: '智能获客',
    label: '按关键词采收线索',
    summary: '在抖音里搜这个词，把搜到的视频下面的评论人收成线索，落进线索池。',
    outbound: true,
    estMinutes: 8,
    fields: [
      {
        name: 'keyword',
        label: '关键词',
        type: 'text',
        required: true,
        placeholder: '如：AI人工智能训练师',
        help: '就是你在抖音搜索框里会输入的那个词。',
      },
      {
        name: 'max_videos',
        label: '最多采几条视频',
        type: 'number',
        required: false,
        defaultValue: 6,
        help: '一条视频通常能出几个到几十个线索。采太多会让这台手机占用很久。',
      },
    ],
  },
  {
    id: 'dm_one',
    dept: '智能获客',
    label: '给指定的人发一条私信',
    summary: '用这台机器上的账号，给你指定的那个人发一条私信。',
    outbound: true,
    estMinutes: 3,
    fields: [
      {
        name: 'target',
        label: '发给谁',
        type: 'text',
        required: true,
        placeholder: '抖音号，或对方主页链接',
        help: '填抖音号最稳；主页链接也行（会自动解析）。',
      },
      {
        name: 'message',
        label: '发什么',
        type: 'textarea',
        required: true,
        placeholder: '想说的话',
        help: '用哪个号发由这台机器自己定（按它绑的账号路由），你不用选。',
      },
    ],
  },
  {
    id: 'outreach_round',
    dept: '智能获客',
    label: '跑一轮触达',
    summary: '从待触达名单里按顺序取人，挨个发私信，发到当日额度用完或没人可发为止。',
    outbound: true,
    estMinutes: 20,
    fields: [],
  },
];

/** 这个部门有哪些活可派 */
export function jobsOfDept(dept: Dept): JobDef[] {
  return JOB_CATALOG.filter((j) => j.dept === dept);
}

export function findJob(id: string): JobDef | undefined {
  return JOB_CATALOG.find((j) => j.id === id);
}

/** 有活可派的部门（用于在部门下拉里给没活的部门加标注） */
export function deptsWithJobs(): Dept[] {
  return Array.from(new Set(JOB_CATALOG.map((j) => j.dept)));
}

/** 表单初值：用字段声明的默认值 */
export function initialValues(job: JobDef): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of job.fields) v[f.name] = f.defaultValue === undefined ? '' : String(f.defaultValue);
  return v;
}

/**
 * 校验必填项，返回人话的缺失提示。
 * 在前端先拦一道，让用户当场知道缺什么，而不是提交后等后端报错。
 */
export function validateValues(job: JobDef, values: Record<string, string>): string | null {
  for (const f of job.fields) {
    const raw = (values[f.name] ?? '').trim();
    if (f.required && !raw) return `请填「${f.label}」`;
    if (raw && f.type === 'number' && !/^\d+$/.test(raw)) return `「${f.label}」要填数字`;
  }
  return null;
}

/**
 * 组装成派给工作机的 params。
 *
 * 只带 job_type 与用户填的值 —— 不替工作机决定用哪个脚本、哪个账号、哪个 profile。
 */
export function buildJobParams(job: JobDef, values: Record<string, string>): Record<string, string> {
  const params: Record<string, string> = { job_type: job.id };
  for (const f of job.fields) {
    const raw = (values[f.name] ?? '').trim();
    if (raw) params[f.name] = raw;
    else if (f.defaultValue !== undefined) params[f.name] = String(f.defaultValue);
  }
  return params;
}

/** 活的标题：主理人在时间线上看到的那行字 */
export function buildJobTitle(job: JobDef, values: Record<string, string>): string {
  const key = job.fields.find((f) => f.required && f.type !== 'textarea');
  const v = key ? (values[key.name] ?? '').trim() : '';
  return v ? `${job.label} · ${v}` : job.label;
}
