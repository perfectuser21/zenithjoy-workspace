#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeReadOnly } from './phone-probe.mjs';
import { createMerchantAdapter } from './merchant-adapter.mjs';

const [command, file, bindingFile] = process.argv.slice(2);
if (command === '--help') {
  process.stdout.write('只读手机证据：node phone-probe-cli.mjs capture 配置.json 受信任设备绑定.json\n业务前提检查：node phone-probe-cli.mjs validate 请求.json\n截图和XML仅为待视觉审阅证据，不代表商品验收通过。本版本没有发布驱动。仅创建并清理本次UI取证文件。\n');
} else {
  try {
    if (!['capture', 'validate'].includes(command) || !file) throw new Error('INVALID_ARGUMENTS: 使用 --help 查看只读命令');
    const input = JSON.parse(readFileSync(resolve(file), 'utf8'));
    if (command === 'capture' && !bindingFile) throw new Error('DEVICE_BINDING_REQUIRED');
    const result = command === 'capture' ? await probeReadOnly(input, { deviceBinding: JSON.parse(readFileSync(resolve(bindingFile), 'utf8')) })
      : await createMerchantAdapter({ probe: () => probeReadOnly(input) }).validate(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (command === 'validate' && !result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message, manifest: error.manifest || null })}\n`);
    process.exitCode = 2;
  }
}
