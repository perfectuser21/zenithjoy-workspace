/**
 * 守卫：`services/agent/src/` 下的下载地址不许再用全球加速域名。
 *
 * 客户在国内、桶在广州——走 cos.accelerate 是拿跨境通道下国内文件，又慢又贵。
 * 2026-07 账单「全球加速下行流量_境内到境内」33.28 元就是这么来的。
 *
 * 这是个会真报红的守卫：谁在本目录下把 accelerate 写回去，CI 当场拦。
 *
 * ── ⚠️ 覆盖边界：本守卫【只扫 services/agent/src/】，不扫别处 ──────────
 * 全仓库还有 9 处 cos.accelerate 未处理，本期刻意不动，别以为全仓库已经干净：
 *
 *   services/agent/modules/line04/preflight.ts        微信安装包下载（真该改）
 *   services/agent/modules/line04/wechat-rpa/*.py     同上
 *   services/agent/wechat-rpa/*.py                    同上
 *   services/agent/build-modules/line04/**            上面几个的构建产物，同源
 *   services/agent/modules/line04/__tests__/preflight.test.ts:262
 *       ↑ 有一条 expect(...).toContain('cos.accelerate...') 把加速域名锁死了，
 *         改源码必须同时改它
 *
 * 为什么本期不动：line04 是微信客服线，改它的生产路径按规矩要在西安 rog 真机
 * 验证，而本 PR 的主线是素材 COS 直传——混进来会把一个能合的 PR 拖在真机上。
 *
 * 另外两类【不是漏改，是判断后保留】：
 *   .github/workflows/scripts/smoke/rotation-normalize-smoke.sh
 *       跑在 GitHub Actions 美国 runner 上，走加速反而合理
 *   apps/{api,dashboard}/**\/install-pack-manifest.test.ts
 *       测试自己造 fixture 再断言 fixture，是同义反复，不反映生产行为
 *
 * 扩大覆盖 = 把 SRC 换成 services/agent 根目录并放开文件后缀，届时上面 9 处会
 * 全部报红，这正是它该有的行为。
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
  it('services/agent/src/ 下不许出现 cos.accelerate（注意：本守卫不覆盖 modules/ 与 wechat-rpa/，见文件头）', () => {
    const offenders = walk(SRC)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('cos.accelerate'))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('确实在用广州直连域名（防止被整段删掉而假绿）', () => {
    // 这里找的是【源码文本里的地域标识】，不是在校验一个 URL 的主机名。
    //
    // 只匹配 'cos.ap-guangzhou' 而不是完整域名，有两个原因：
    //  ① 有意义的对比本来就是「ap-guangzhou 直连」vs「accelerate 跨境加速」，
    //     地域段才是判据，后缀 .myqcloud.com 两边都一样，带上它不增加任何信息
    //  ② 用完整主机名会被 CodeQL 的 js/incomplete-url-substring-sanitization 判为
    //     「不完整的 URL 主机名校验」——那条规则针对的是拿 includes() 校验 URL 的
    //     场景（任意主机可以出现在它前后），而我们是在 grep 源码文本，不是校验 URL
    const REGION_MARKER = 'cos.ap-guangzhou';
    const hit = walk(SRC).some((f) => fs.readFileSync(f, 'utf8').includes(REGION_MARKER));
    expect(hit).toBe(true);
  });
});
