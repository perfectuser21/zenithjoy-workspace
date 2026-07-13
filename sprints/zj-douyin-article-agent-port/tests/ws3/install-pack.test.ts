// vitest globals injected
// Red state: version 仍为 1.1.25，build-install-pack.sh 未含 publishers 复制 → failures

const PKG_PATH = '/workspace/services/agent/package.json';
const BUILD_SCRIPT = '/workspace/services/agent/scripts/build-install-pack.sh';

describe('install-pack + version bump [BEHAVIOR]', () => {
  it('package.json version === "1.1.26"', () => {
    const pkg = require(PKG_PATH);
    // Red: 当前 version = "1.1.25"
    expect(pkg.version).toBe('1.1.26');
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
