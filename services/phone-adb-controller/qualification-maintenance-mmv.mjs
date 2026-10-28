import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {digest} from './runtime-definition.mjs';
const reader=fileURLToPath(new URL('./qualification-maintenance-mmv.py',import.meta.url));
export const mmvRpcObserverDigest=digest(readFileSync(reader));
// 生产导出固定 canonical 解释器；内部工厂仅给跨平台真实内核回归提供依赖。
export function createMmvRpcReader(python='/opt/homebrew/bin/python3') {
 return function readMmvRpcClosure(scope) {
 const r=spawnSync(python,['-B','-I',reader],{input:JSON.stringify({consumer_source:scope.consumer_source,run_tag:scope.run_tag}),encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 let result;try{result=JSON.parse(r.stdout);}catch{throw Error('MAINTENANCE_MMV_RPC_UNKNOWN');}
 if(r.status!==0||r.signal||r.error||result.observer_sha256!==mmvRpcObserverDigest||result.source_commit!==scope.consumer_source
  ||result.run_tag!==scope.run_tag||result.run_id!=='douyin_video_processing-'+scope.run_tag+'__a1'
  ||result.completed_at_ms<Date.now()-10000||result.completed_at_ms>Date.now()+2000)
  throw Error('MAINTENANCE_MMV_RPC_UNKNOWN');
 return result;
}
}
export const readMmvRpcClosure=createMmvRpcReader();
