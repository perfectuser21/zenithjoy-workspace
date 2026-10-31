#!/usr/bin/env node
// adapter 是受信任的本地代码插件；不要加载客户提交的代码路径。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coordinate, inspect } from './coordinator.mjs';

try {
  const [command, requestFile, adapterFile] = process.argv.slice(2);
  if (!['inspect', 'run'].includes(command) || !requestFile || (command === 'run' && !adapterFile)) {
    throw new Error('用法：node cli.mjs inspect 请求.json；或 run 请求.json 受信任适配器.mjs');
  }
  const request = JSON.parse(readFileSync(resolve(requestFile), 'utf8'));
  const result = command === 'inspect' ? inspect(request)
    : await coordinate(request, (await import(pathToFileURL(resolve(adapterFile)).href)).default);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
