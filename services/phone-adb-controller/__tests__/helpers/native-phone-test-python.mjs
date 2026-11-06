// Test-only physical Python/Pillow inputs. Production policy and loaders never read these variables.
import {execFileSync} from 'node:child_process';
import {realpathSync,lstatSync,readdirSync,mkdirSync,mkdtempSync} from 'node:fs';
import {isAbsolute,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
export function nativePhoneTestPython(){
 const path=realpathSync(process.env.PREFLIGHT_TEST_PYTHON_BIN||process.env.ZJ_NATIVE_PHONE_TEST_PYTHON||'/opt/homebrew/Cellar/python@3.14/3.14.3_1/Frameworks/Python.framework/Versions/3.14/bin/python3.14');
 if(!isAbsolute(path)||!lstatSync(path).isFile()||(lstatSync(path).mode&0o022))throw Error('NATIVE_PHONE_TEST_PYTHON');
 return path;
}
export function nativePhoneTestPilRoot(python=nativePhoneTestPython()){
 const supplied=process.env.PREFLIGHT_TEST_PIL_ROOT;
 const path=supplied??execFileSync(python,['-I','-c','import PIL,os;print(os.path.dirname(os.path.realpath(PIL.__file__)))'],{encoding:'utf8',timeout:10000}).trim();
 if(!isAbsolute(path)||realpathSync(path)!==path||path.split('/').at(-1)!=='PIL')throw Error('NATIVE_PHONE_TEST_PIL_ROOT');
 const scan=directory=>{for(const row of readdirSync(directory,{withFileTypes:true})){if(row.name==='__pycache__')continue;const p=join(directory,row.name),st=lstatSync(p);if(st.isSymbolicLink()||(st.mode&0o022)||!st.isFile()&&!st.isDirectory())throw Error('NATIVE_PHONE_TEST_PIL_TREE');if(st.isDirectory())scan(p);}};
 if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())throw Error('NATIVE_PHONE_TEST_PIL_ROOT');scan(path);return path;
}
export function nativePhoneTestImageArgs(code,args=[],python=nativePhoneTestPython()){
 const root=nativePhoneTestPilRoot(python);
 return ['-I','-S','-c','import sys\nsys.path.insert(0,'+JSON.stringify(dirname(root))+')\n'+code,...args];
}
export function nativePhoneTestArtifacts(){
 const requested=process.env.PREFLIGHT_TEST_PHONE_ARTIFACTS;
 if(requested!==undefined){if(!isAbsolute(requested)||/[\r\n]/.test(requested))throw Error('NATIVE_PHONE_TEST_ARTIFACTS');mkdirSync(requested,{recursive:true,mode:0o700});return mkdtempSync(join(realpathSync(requested),'phone-'));}
 return mkdtempSync(join(tmpdir(),'native-phone-test-artifacts-'));
}
export function nativePhoneTestPgMetadata(){
 const path=process.env.ZJ_NATIVE_103_PG_FIXTURE??process.env.ZJ_NATIVE_PHONE_QUEUE_PG_FIXTURE;
 if(!path||!isAbsolute(path))throw Error('NATIVE_PHONE_TEST_PG_METADATA_REQUIRED');
 if(process.env.ZJ_NATIVE_103_PG_FIXTURE&&process.env.ZJ_NATIVE_PHONE_QUEUE_PG_FIXTURE&&process.env.ZJ_NATIVE_103_PG_FIXTURE!==process.env.ZJ_NATIVE_PHONE_QUEUE_PG_FIXTURE)throw Error('NATIVE_PHONE_TEST_PG_METADATA_CONFLICT');
 return path;
}
