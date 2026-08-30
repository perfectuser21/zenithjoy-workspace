import fs from 'node:fs/promises';
import path from 'node:path';
/** 截图根目录：与 SCREENSHOTS_DIR 同源，子目录 worker-shots */
export const SHOTS_ROOT = path.join(process.env.SCREENSHOTS_DIR || '/opt/zenithjoy/screenshots', 'worker-shots');
const SAFE_SEG = /^[A-Za-z0-9_-]+$/;
/** 写入截图，返回 ref（`<tenant>/<task>/<step>.jpg`） */
export async function saveShot(tenantId: string, taskId: string, stepIndex: number, jpegBase64: string): Promise<string> {
  if (!SAFE_SEG.test(tenantId) || !SAFE_SEG.test(taskId)) {
    throw new Error('unsafe shot path segment');
  }
  const dir = path.join(SHOTS_ROOT, tenantId, taskId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${stepIndex}.jpg`), Buffer.from(jpegBase64, 'base64'));
  return `${tenantId}/${taskId}/${stepIndex}.jpg`;
}
/** ref → 绝对路径；非法 ref 返回 null（防路径穿越） */
export function shotPath(ref: string): string | null {
  const parts = ref.split('/');
  if (parts.length !== 3) return null;
  const [t, k, f] = parts;
  if (!SAFE_SEG.test(t) || !SAFE_SEG.test(k) || !/^\d+\.jpg$/.test(f)) return null;
  return path.join(SHOTS_ROOT, t, k, f);
}
