// Setup file: inject require() for sprint tests that use dynamic CJS require
// Sprint tests use: require('../../../apps/dashboard/src/utils/keywords')
// from path sprints/<sprint>/tests/<file>.ts
// '../../../' resolves to workspace root, then 'apps/dashboard/src/utils/keywords'
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const workspaceRoot = path.resolve(fileURLToPath(import.meta.url), '..');
// Create require as if called from sprints/<any>/tests/ (3 levels below root = sprint tests)
// require('../../../foo') from that location resolves to workspaceRoot/foo
const fakeCallerPath = path.join(workspaceRoot, 'placeholder-sprint', 'tests', 'x.js');
globalThis.require = createRequire(fakeCallerPath);
