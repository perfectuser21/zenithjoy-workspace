// Test-only identity. Production host policy is never edited or overridden.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
export function native103TestPython(root,{env=process.env}={}){
 const path=env.PREFLIGHT_TEST_PYTHON_BIN;
 if(path===undefined){
  const pins=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.filter(h=>h.target==='mmv').map(h=>h.executables.python);
  if(!pins.length||pins.some(p=>JSON.stringify(p)!==JSON.stringify(pins[0])))throw Error('NATIVE_103_TEST_PYTHON_POLICY');
  return structuredClone(pins[0]);
 }
 if(!isAbsolute(path)||realpathSync(path)!==path)throw Error('NATIVE_103_TEST_PYTHON_PATH');
 const st=lstatSync(path);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022))throw Error('NATIVE_103_TEST_PYTHON_FILE');
 return {path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
}
export function bindNative103TestPython(runtimeRoot){
 if(process.env.PREFLIGHT_TEST_PYTHON_BIN===undefined)return;
 const pin=native103TestPython(runtimeRoot),path=join(runtimeRoot,'config/collection-phone-hosts.json');
 return {path,pin,policy:{...JSON.parse(readFileSync(path)),hosts:JSON.parse(readFileSync(path)).hosts.map(h=>h.target==='mmv'?{...h,executables:{...h.executables,python:pin}}:h)}};
}
