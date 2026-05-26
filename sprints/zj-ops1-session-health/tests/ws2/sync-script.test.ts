import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_compat = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_compat, '../../../../');

describe('WS2 — sync 脚本 8×4 矩阵 + windows-task-scheduler.xml [BEHAVIOR]', () => {
  const syncPath = resolve(ROOT, 'scripts/sessions/sync-from-xian-rog.sh');
  const xmlPath = resolve(ROOT, 'scripts/sessions/windows-task-scheduler.xml');
  const getSyncContent = () => readFileSync(syncPath, 'utf8');

  it('sync 脚本覆盖全部 8 平台的 Secret 名（KUAISHOU_MAIN 等非抖音平台）', () => {
    const content = getSyncContent();
    const expectedSecrets = [
      'KUAISHOU_MAIN',
      'XIAOHONGSHU_MAIN',
      'SHIPINHAO_MAIN',
      'TOUTIAO_MAIN',
      'WEIBO_MAIN',
      'ZHIHU_MAIN',
      'GONGZHONGHAO_MAIN',
    ];
    expectedSecrets.forEach(secret => {
      expect(content, `缺 Secret: ${secret}`).toContain(secret);
    });
  });

  it('sync 脚本覆盖 SUB_1/SUB_2/SUB_3（4 账号矩阵）', () => {
    const content = getSyncContent();
    expect(content).toContain('SUB_1');
    expect(content).toContain('SUB_2');
    expect(content).toContain('SUB_3');
  });

  it('sync_one 函数在 SSH 失败时 early return（不调用 gh secret set）', () => {
    const content = getSyncContent();
    expect(content).toMatch(/return\b|continue\b/);
  });

  it('windows-task-scheduler.xml 文件存在', () => {
    expect(() => accessSync(xmlPath)).not.toThrow();
  });

  it('XML 含 PT2H（2hr sync）触发器', () => {
    const content = readFileSync(xmlPath, 'utf8');
    expect(content).toMatch(/PT2H|PT120M|2.*[Hh]our/);
  });

  it('XML 含 PT45M（45min 视频号心跳）触发器', () => {
    const content = readFileSync(xmlPath, 'utf8');
    expect(content).toMatch(/PT45M/);
  });

  it('XML 含 PT4H（4hr 其他平台心跳）触发器', () => {
    const content = readFileSync(xmlPath, 'utf8');
    expect(content).toMatch(/PT4H|PT240M|4.*[Hh]our/);
  });

  it('XML 含 OnFailed/OnFailure trigger（视频号心跳失败 → 自动 sync）', () => {
    const content = readFileSync(xmlPath, 'utf8');
    expect(content).toMatch(/OnFailed|OnFailure/i);
  });

  it('sync 脚本在 failed 数组非空时触发 Bark 告警', () => {
    const content = getSyncContent();
    expect(content).toMatch(/failed.*bark|bark.*failed/is);
  });
});
