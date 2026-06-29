import * as fs from 'node:fs';

/**
 * 在 envPath 指定的 .env 文件里更新或追加 key=value。
 * - 文件不存在 → 新建
 * - 已有该 key → 替换（保留其余行）
 * - 没有该 key → 追加到末尾
 */
export function writeEnvVar(envPath: string, key: string, value: string): void {
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    // 文件不存在，从空内容开始
  }

  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) {
    content = content.replace(pattern, `${key}=${value}`);
  } else {
    content = content.trimEnd() + (content.length > 0 ? '\n' : '') + `${key}=${value}\n`;
  }

  fs.writeFileSync(envPath, content, 'utf8');
}
