/**
 * 工作目录的守卫（task 3abb7f8c）
 *
 * 主理人要的是「列出这个部门有哪些工作，我点了之后告诉我要填什么」。
 * 这里守两件事：**列出来的活必须是真能跑的**，**要填的东西必须说得清**。
 */
import { describe, it, expect } from 'vitest';
import {
  JOB_CATALOG,
  jobsOfDept,
  findJob,
  deptsWithJobs,
  initialValues,
  validateValues,
  buildJobParams,
  buildJobTitle,
} from '../job-catalog';
import { DEPTS } from '../schedule.api';

describe('只列真能跑的活，不画饼', () => {
  it('目前只有智能获客一条线有活——其余部门的活不在这台机器上', () => {
    expect(deptsWithJobs()).toEqual(['智能获客']);
  });

  it('没活的部门返回空数组（页面据此显示"还没有可派的活"，而不是给空下拉）', () => {
    for (const d of DEPTS.filter((x) => x !== '智能获客')) {
      expect(jobsOfDept(d)).toEqual([]);
    }
  });

  it('每件活都说清了"派下去会发生什么"', () => {
    for (const j of JOB_CATALOG) {
      expect(j.summary.length, `${j.label} 没写清楚会发生什么`).toBeGreaterThan(10);
    }
  });

  it('活的 id 唯一——领单器按它分派，撞车会派错脚本', () => {
    const ids = JOB_CATALOG.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('碰平台的活都标了 outbound（决定是否受 30 分钟窗口约束）', () => {
    // 采收要在抖音里搜、私信要发出去，三件都碰平台
    expect(JOB_CATALOG.every((j) => j.outbound)).toBe(true);
  });
});

describe('每个输入框都要说人话', () => {
  it('必填项有 label，数字/文本类型明确', () => {
    for (const j of JOB_CATALOG) {
      for (const f of j.fields) {
        expect(f.label.length, `${j.id}.${f.name} 没有 label`).toBeGreaterThan(0);
        expect(['text', 'number', 'textarea']).toContain(f.type);
      }
    }
  });

  it('非必填项要么有默认值、要么有说明——不能让人猜留空会怎样', () => {
    for (const j of JOB_CATALOG) {
      for (const f of j.fields.filter((x) => !x.required)) {
        expect(f.defaultValue !== undefined || !!f.help, `${j.id}.${f.name} 既没默认值也没说明`).toBe(true);
      }
    }
  });

  it('采收要填关键词与条数，私信要填发给谁和发什么', () => {
    expect(findJob('harvest_keyword')!.fields.map((f) => f.name)).toEqual(['keyword', 'max_videos']);
    expect(findJob('dm_one')!.fields.map((f) => f.name)).toEqual(['target', 'message']);
  });

  it('跑一轮触达不用填任何东西（系统自己从名单取人）', () => {
    expect(findJob('outreach_round')!.fields).toEqual([]);
  });
});

describe('表单初值与校验', () => {
  const harvest = findJob('harvest_keyword')!;

  it('初值用字段声明的默认值', () => {
    expect(initialValues(harvest)).toEqual({ keyword: '', max_videos: '6' });
  });

  it('必填项空着时给出人话提示，指名是哪个框', () => {
    expect(validateValues(harvest, { keyword: '', max_videos: '6' })).toBe('请填「关键词」');
  });

  it('数字框填了非数字要拦住', () => {
    expect(validateValues(harvest, { keyword: 'AI', max_videos: '六' })).toBe('「最多采几条视频」要填数字');
  });

  it('填齐了就放行', () => {
    expect(validateValues(harvest, { keyword: 'AI训练师', max_videos: '6' })).toBeNull();
  });

  it('没有输入项的活直接放行', () => {
    expect(validateValues(findJob('outreach_round')!, {})).toBeNull();
  });
});

describe('组装给工作机的参数', () => {
  const harvest = findJob('harvest_keyword')!;

  it('只带 job_type 与用户填的值——不替工作机决定脚本/账号/profile', () => {
    const p = buildJobParams(harvest, { keyword: 'AI训练师', max_videos: '6' });
    expect(p).toEqual({ job_type: 'harvest_keyword', keyword: 'AI训练师', max_videos: '6' });
    expect(Object.keys(p)).not.toContain('profile');
    expect(Object.keys(p)).not.toContain('action');
  });

  it('留空的非必填项补上默认值，不让工作机去猜', () => {
    const p = buildJobParams(harvest, { keyword: 'AI训练师', max_videos: '' });
    expect(p.max_videos).toBe('6');
  });

  it('标题带上关键信息，好在时间线上认出是哪一单', () => {
    expect(buildJobTitle(harvest, { keyword: 'AI训练师', max_videos: '6' })).toBe('按关键词采收线索 · AI训练师');
  });

  it('多行输入（话术）不进标题——太长会把时间线撑坏', () => {
    const dm = findJob('dm_one')!;
    expect(buildJobTitle(dm, { target: 'langzi63485', message: '很长很长的一段话术'.repeat(5) }))
      .toBe('给指定的人发一条私信 · langzi63485');
  });
});
