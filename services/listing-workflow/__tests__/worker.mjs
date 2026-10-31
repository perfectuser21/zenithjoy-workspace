import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { coordinate } from '../coordinator.mjs';
const input = JSON.parse(process.argv[2]); const mode = process.argv[3];
const effects = join(input.root, 'effects.log');
const adapter = {
  validate: async () => ({ ok: true, evidence: ['fixture-validation'] }),
  submit: async () => {
    appendFileSync(effects, `${input.businessKey}\n`);
    if (mode === 'crash') process.kill(process.pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 50));
    return { productId: '123', evidence: ['fixture-receipt'] };
  },
  lookup: async intent => mode === 'lookup' && existsSync(effects)
    ? { state: 'verified', productId: '123', evidence: ['fixture-readback'], binding: { intentId: intent.intentId, fingerprint: intent.fingerprint, businessKey: intent.businessKey } }
    : { state: 'not_found' },
};
process.stdout.write(JSON.stringify(await coordinate(input, adapter)));
