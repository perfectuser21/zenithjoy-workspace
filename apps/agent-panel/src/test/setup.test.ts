import { describe, it, expect } from 'vitest';

// setup.ts 通过 vitest.config.ts 的 setupFiles 在每个测试文件运行前自动加载，
// 本文件验证它确实生效了——jest-dom 自定义 matcher(toBeInTheDocument等)真的挂上了 expect，
// 不是配置了但从没跑过（配置文件本身没有"入口函数"可以直接调用测试，这是它能被验证生效的方式）。
describe('test/setup（@testing-library/jest-dom 自定义matcher已挂载）', () => {
  it('toBeInTheDocument matcher 真实可用', () => {
    document.body.innerHTML = '<div id="probe">x</div>';
    const el = document.getElementById('probe');
    expect(el).toBeInTheDocument();
  });

  it('未挂载的元素 toBeInTheDocument 断言为假', () => {
    const detached = document.createElement('div');
    expect(detached).not.toBeInTheDocument();
  });
});
