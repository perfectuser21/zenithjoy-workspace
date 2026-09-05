/**
 * 守卫：agent 的下载地址不许再用全球加速域名。
 *
 * 客户在国内、桶在广州——走 cos.accelerate 是拿跨境通道下国内文件，又慢又贵。
 * 2026-07 账单「全球加速下行流量_境内到境内」33.28 元就是这么来的。
 *
 * 这是个会真报红的守卫：谁把 accelerate 写回去，CI 当场拦。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('COS 下载域名', () => {
  it('agent 源码里不许出现 cos.accelerate', () => {
    const offenders = walk(SRC)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('cos.accelerate'))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('确实在用广州直连域名（防止被整段删掉而假绿）', () => {
    const hit = walk(SRC).some((f) => fs.readFileSync(f, 'utf8').includes('cos.ap-guangzhou.myqcloud.com'));
    expect(hit).toBe(true);
  });
});
