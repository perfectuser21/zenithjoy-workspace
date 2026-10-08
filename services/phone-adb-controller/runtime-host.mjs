import {hostname} from 'node:os';
// 只规范机器名，不读取部署或运行状态；部署采集与运行门禁共享同一规则。
export function deploymentTarget(value){
 const name=value.toLowerCase().split('.')[0];
 // machines 真身 ed3555dc-4777-446c-bdf0-d928d6a08ef1：mac-mini-m4-us，已核 hostname aad17-2。
 if(name==='aad17-2')return 'mmv';
 if(name.includes('m4-xian'))return 'xian-m4';
 if(name.includes('m1-us'))return 'xian-m1';
 return name;
}
export function assertRuntimeHost(release,deployment){
 const actual=deploymentTarget(hostname());
 if(release?.target!==actual||deployment?.target!==actual)throw Error('实际机器与固定release及部署观测目标不匹配');
 return actual;
}
