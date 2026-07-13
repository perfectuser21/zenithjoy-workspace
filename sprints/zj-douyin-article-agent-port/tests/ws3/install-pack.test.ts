// vitest globals injected
// Red state: version 仍为 1.1.25，build-install-pack.sh 未含 publishers 复制 → failures

// 路径相对 repo 根解析（原写死 harness 容器 /workspace/ 绝对路径，出容器必挂——巡检 2026-07-12 收编时修正）
import * as path from 'node:path';
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const PKG_PATH = path.join(REPO_ROOT, 'services/agent/package.json');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'services/agent/scripts/build-install-pack.sh');

describe('install-pack + version bump [BEHAVIOR]', () => {
  it('package.json version ≥ 1.1.26（sprint 时点断言"===1.1.26"，收编改为语义化下界）', () => {
    const pkg = require(PKG_PATH);
    const [maj, min, pat] = String(pkg.version).split('.').map(Number);
    expect(maj * 1e6 + min * 1e3 + pat).toBeGreaterThanOrEqual(1 * 1e6 + 1 * 1e3 + 26);
  });

  it('旧版本 "1.1.25" 不再是 package.json version 字段', () => {
    const pkg = require(PKG_PATH);
    expect(pkg.version).not.toBe('1.1.25');
  });

  it('build-install-pack.sh 含 publishers 复制命令', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(BUILD_SCRIPT, 'utf8');
    // Red: 当前 build 脚本无 publishers cp 逻辑
    expect(src).toMatch(/publishers/);
  });

  it('build-install-pack.sh publishers 复制覆盖 douyin-publisher 子目录', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(BUILD_SCRIPT, 'utf8');
    expect(src).toMatch(/publishers.*douyin|douyin.*publishers|publishers\//);
  });
});
