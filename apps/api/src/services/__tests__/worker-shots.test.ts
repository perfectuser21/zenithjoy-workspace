import { describe, it, expect } from 'vitest';
import { saveShot, shotPath } from '../worker-shots';

describe('shotPath', () => {
  it('非法 ref → 返回 null（段数不对/非法字符/文件名不是 N.jpg）', () => {
    expect(shotPath('../x/0.jpg')).toBeNull();
    expect(shotPath('a/b')).toBeNull();
    expect(shotPath('a/b/c.txt')).toBeNull();
    expect(shotPath('a/b/0.jpg')).not.toBeNull();
  });
});

describe('saveShot', () => {
  it('tenantId 含非法路径段（如 ..）→ rejects', async () => {
    await expect(saveShot('../x', 't', 0, 'AAAA')).rejects.toThrow('unsafe shot path segment');
  });
  it('taskId 含非法路径段 → rejects', async () => {
    await expect(saveShot('t', '../x', 0, 'AAAA')).rejects.toThrow('unsafe shot path segment');
  });
});
