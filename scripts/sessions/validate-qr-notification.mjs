import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function validateQrNotification({ receipt, result, exitCode, runId, platform }) {
  if (!platform || receipt.platform !== platform || result.platform !== platform) throw new Error('receipt/result platform mismatch');
  if (!runId || receipt.run_id !== runId) throw new Error('receipt must belong to this workflow run');
  if (receipt.status !== 'api_accepted' || receipt.api_code !== 0 || !receipt.image_key) throw new Error('notification API acceptance not proven');
  const box = receipt.capture;
  if (box?.kind !== 'element' || !(box.width >= 100 && box.width <= 400 && box.height >= 100 && box.height <= 400) || box.width / box.height < 0.8 || box.width / box.height > 1.25) throw new Error('QR element crop bounds not proven');
  const normalTimeout = exitCode === 1 && result.ok === false && String(result.error).startsWith('扫码超时');
  if (!(exitCode === 0 && result.ok === true) && !normalTimeout) throw new Error('binding crashed or exited for a non-timeout reason');
  return { status: 'notification_api_accepted', delivery_verified: false, image_key: receipt.image_key, run_id: runId };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [receiptFile, resultFile, code, runId, platform] = process.argv.slice(2);
  const lines = readFileSync(resultFile, 'utf8').trim().split(/\r?\n/);
  const result = JSON.parse(lines.at(-1));
  const validated = validateQrNotification({ receipt: JSON.parse(readFileSync(receiptFile, 'utf8')), result, exitCode: Number(code), runId, platform });
  console.log(JSON.stringify(validated));
  console.log('API_ACCEPTANCE_ONLY; external delivery/QR readability require independent readback');
}
