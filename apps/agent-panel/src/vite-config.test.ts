// @vitest-environment node
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('vite base path', () => {
  it('uses relative base so file:// navigation resolves asset paths', () => {
    // xian-rog 真机验证实测：MainWindow.xaml.cs 用 file:// 打开 dist/index.html，
    // 默认 base:'/' 生成的绝对路径 <script src="/assets/..."> 在 file:// 下解析到磁盘根，
    // 资源404，WebView2 停在空白页。base 必须是相对路径。
    expect(viteConfig.base).toBe('./');
  });
});
