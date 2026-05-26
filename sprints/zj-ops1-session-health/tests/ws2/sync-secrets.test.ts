import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const syncPath = 'scripts/sessions/sync-from-xian-rog.sh';
const xmlPath = 'scripts/sessions/windows-task-scheduler.xml';

describe('WS2 — sync-from-xian-rog.sh 扩展 + windows-task-scheduler.xml [BEHAVIOR]', () => {
  const syncCode = readFileSync(syncPath, 'utf-8');

  it('sync 脚本应包含 KUAISHOU_MAIN Secret 引用', () => {
    expect(syncCode).toContain('KUAISHOU_MAIN');
  });

  it('sync 脚本应包含所有 7 个新增平台的 MAIN Secret 引用', () => {
    const platforms = [
      'KUAISHOU_MAIN', 'XIAOHONGSHU_MAIN', 'SHIPINHAO_MAIN',
      'TOUTIAO_MAIN', 'WEIBO_MAIN', 'ZHIHU_MAIN', 'WECHAT_MAIN',
    ];
    const missing = platforms.filter(p => !syncCode.includes(p));
    expect(missing).toHaveLength(0);
  });

  it('sync 脚本应含错误容错逻辑（failed 数组或 continue 机制）', () => {
    const hasErrorHandling = syncCode.includes('failed') ||
      syncCode.includes('|| true') ||
      syncCode.includes('continue');
    expect(hasErrorHandling).toBe(true);
  });

  it('sync 脚本不应包含硬编码 GitHub token（ghp_ 开头）', () => {
    expect(syncCode).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
  });

  it('windows-task-scheduler.xml 文件应存在', () => {
    expect(existsSync(xmlPath)).toBe(true);
  });

  it('windows-task-scheduler.xml 应包含 2 小时 sync 触发器', () => {
    const xml = readFileSync(xmlPath, 'utf-8');
    const has2hr = xml.includes('PT2H') || xml.includes('02:00:00') || xml.includes('Hour>2');
    expect(has2hr).toBe(true);
  });

  it('windows-task-scheduler.xml 应包含 45 分钟视频号心跳触发器', () => {
    const xml = readFileSync(xmlPath, 'utf-8');
    const has45min = xml.includes('PT45M') || xml.includes('00:45:00') || xml.includes('Minute>45');
    expect(has45min).toBe(true);
  });

  it('windows-task-scheduler.xml 应包含 4 小时其他平台心跳触发器', () => {
    const xml = readFileSync(xmlPath, 'utf-8');
    const has4hr = xml.includes('PT4H') || xml.includes('04:00:00') || xml.includes('Hour>4');
    expect(has4hr).toBe(true);
  });
});
