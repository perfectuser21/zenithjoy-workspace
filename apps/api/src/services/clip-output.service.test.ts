import { describe, it, expect } from 'vitest';
import { parseOutputUrl } from './clip-output.service';

describe('parseOutputUrl', () => {
  it('detects Notion database URL', () => {
    const result = parseOutputUrl(
      'https://www.notion.so/myworkspace/My-DB-770c40c2ba6383ea86d001eba832c218?v=abc'
    );
    expect(result).toEqual({ type: 'notion', databaseId: '770c40c2-ba63-83ea-86d0-01eba832c218' });
  });

  it('detects Notion URL without dashes', () => {
    const result = parseOutputUrl('https://notion.so/770c40c2ba6383ea86d001eba832c218');
    expect(result).toEqual({ type: 'notion', databaseId: '770c40c2-ba63-83ea-86d0-01eba832c218' });
  });

  it('detects Feishu bitable URL with table param', () => {
    const result = parseOutputUrl(
      'https://p1bce1datcr.feishu.cn/base/EK75bB3aca7YXqsXiQBch48Fnzd?table=tblUzPt9cWEi4EZH'
    );
    expect(result).toEqual({
      type: 'feishu',
      appToken: 'EK75bB3aca7YXqsXiQBch48Fnzd',
      tableId: 'tblUzPt9cWEi4EZH',
    });
  });

  it('detects Feishu bitable URL without table param', () => {
    const result = parseOutputUrl('https://example.feishu.cn/base/MyAppToken123');
    expect(result).toEqual({
      type: 'feishu',
      appToken: 'MyAppToken123',
      tableId: undefined,
    });
  });

  it('returns null for unknown URL', () => {
    expect(parseOutputUrl('https://google.com')).toBeNull();
    expect(parseOutputUrl('')).toBeNull();
  });
});
