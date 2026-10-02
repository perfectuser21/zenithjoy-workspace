import {hostname} from 'node:os';
// 只规范机器名，不读取部署或运行状态；部署采集与运行门禁共享同一规则。
export function deploymentTarget(value){
 const name=value.toLowerCase().split('.')[0];
 if(name.includes('m4-xian'))return 'xian-m4';
 if(name.includes('m1-us'))return 'xian-m1';
 return name;
}
export function assertRuntimeHost(release,deployment){
 const actual=deploymentTarget(hostname());
 if(release?.target!==actual||deployment?.target!==actual)throw Error('实际机器与固定release及部署观测目标不匹配');
 return actual;
}
