#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

// 设计时/部署准备时运行；通用生成器由Cecelia显式提供，不复制其实现。
const [capability, contractPath, sopPath, outputPath, ...extra] = process.argv.slice(2);
try {
  const generator = process.env.CECELIA_COMMANDER_SKILL_GENERATOR;
  if (!generator || !isAbsolute(generator) || extra.length || !outputPath) throw Error('arguments');
  let envelope;
  if (contractPath === '--assembled') {
    const { loadContractsFromDisk, assemble } = await import('../../../scripts/product-map/contracts-lib.mjs');
    const ctx = loadContractsFromDisk(), assembled = assemble(ctx, capability);
    if (!assembled.ok) throw Error('assembly');
    envelope = { contract: { workflow: ctx.contracts[capability].workflow, activities: assembled.activities } };
  } else envelope = JSON.parse(await readFile(resolve(contractPath), 'utf8'));
  const sop = JSON.parse(await readFile(resolve(sopPath), 'utf8'));
  const stdout = await new Promise((accept, reject) => {
    const child = execFile(process.execPath, [generator], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
      (error, data) => error ? reject(error) : accept(data));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ capability, contract: envelope.contract ?? envelope, sop }));
  });
  const result = JSON.parse(stdout);
  if (result.schema_version !== 1 || result.capability !== capability || typeof result.skill !== 'string') throw Error('result');
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  const pending = `${destination}.${randomUUID()}.tmp`;
  await writeFile(pending, result.skill, { mode: 0o600 });
  await rename(pending, destination);
  process.stdout.write(JSON.stringify({ ...result, skill: undefined, path: destination }) + '\n');
} catch {
  process.stderr.write('workflow_skill_build_failed\n'); process.exitCode = 1;
}
