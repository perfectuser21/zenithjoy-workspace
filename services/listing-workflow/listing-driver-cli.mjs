#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runListing } from './listing-driver.mjs';
import { createReadOnlyRuntime } from './listing-readonly-runtime.mjs';
const args = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(resolve(path), 'utf8'));
if (args[0] === '--help') {
  process.stdout.write('默认dry-run：node listing-driver-cli.mjs 请求.json 受信任运行时.mjs [live]\n真实只读采集：node listing-driver-cli.mjs --probe 请求.json 采集配置.json 受信任设备绑定.json\n运行时模块会执行代码，只能加载执行方审阅的本地插件，禁止来自商品请求。当前内置真实运行时生产开关关闭；缺表单锚点/店铺/事实即拒绝。模拟调度通过不代表真机发布完成。\n');
} else {
  try {
    let request, runtime;
    if (args[0] === '--probe' && args.length === 4) {
      request = read(args[1]); runtime = createReadOnlyRuntime({ probeConfig: read(args[2]), deviceBinding: read(args[3]) });
      request.mode = 'dry-run';
    } else {
      if (args.length < 2 || args.length > 3 || (args[2] && args[2] !== 'live')) throw new Error('INVALID_ARGUMENTS: --help');
      request = read(args[0]);
      const plugin = await import(pathToFileURL(resolve(args[1])).href);
      if (typeof plugin.createRuntime !== 'function') throw new Error('TRUSTED_RUNTIME_FACTORY_REQUIRED');
      runtime = await plugin.createRuntime(); request.mode = args[2] === 'live' ? 'live' : 'dry-run';
    }
    const result = await runListing(request, runtime);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.cleanupError || result.status === 'blocked' || result.status === 'unknown') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message, manifest: error.manifest || null })}\n`); process.exitCode = 2;
  }
}
