import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const paths=process.argv[2]==='prototype'?['apps/realtime-voice-mvp/server-local-contract.test.mjs']:process.argv[2]==='ime'?['services/phone-adb-controller/__tests__/private-message-delta.test.mjs']:process.argv[2]==='locator-operator'?['.github/workflows/scripts/operator/rpa-locator-assist-probe.test.mjs']:['scripts/openclaw/__tests__/adb-controller-bridge.test.js'];
const env={...process.env};for(const key of Object.keys(env))if(/API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY/.test(key))delete env[key];
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...paths],{cwd:root,env,encoding:'utf8'});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
const count=label=>Number((result.stdout??'').match(new RegExp(`^# ${label} (\\d+)$`,'m'))?.[1]??NaN);
if(result.status!==0||!(count('tests')>0)||count('pass')!==count('tests')||count('skipped')!==0||count('fail')!==0)throw new Error('Node contract empty/skip/importfailure/failure cannot pass');
