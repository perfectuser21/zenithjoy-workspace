#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { evaluatePlan } from './plan-evidence.mjs';

// trusted-policy.json 属于执行方的固定配置；不得使用客户请求提供的可信摘要白名单。
try {
  const args = process.argv.slice(2), [requestFile, evidenceRoot, policyFile] = args;
  if (args.length !== 3 || !requestFile || !evidenceRoot || !policyFile) throw new Error('用法：node plan-evidence-cli.mjs 请求.json 证据目录 受信任策略.json');
  const request = JSON.parse(readFileSync(requestFile, 'utf8'));
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  const result = evaluatePlan(request, { evidenceRoot, policy });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = { matched: 0, unknown: 2, rejected: 3 }[result.status];
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
