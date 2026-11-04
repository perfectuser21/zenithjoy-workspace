import {groups,runContractGroups} from './media-contracts.mjs';
groups.extra_api={cwd:'apps/api',files:['src/__tests__/startup-check.test.ts','src/schemas/__tests__/agent-protocol-cmd.test.ts','src/services/__tests__/command-bridge.test.ts','src/services/__tests__/agent-registry-unregister-race.test.ts','src/services/__tests__/agent-ws-cmd.test.ts','src/routes/__tests__/devices.test.ts','src/routes/__tests__/agent-install-pack.test.ts','src/services/__tests__/agent-offline-monitor.test.ts','src/routes/__tests__/agent-offline-scan.test.ts']};
groups.extra_pg={postgres:true,cwd:'apps/api',files:['tests/integration/media-extra/runtime.test.ts'],config:'vitest.media-extra-pg.config.ts'};
runContractGroups(process.argv.length>2?process.argv.slice(2):['extra_api','extra_pg']);
