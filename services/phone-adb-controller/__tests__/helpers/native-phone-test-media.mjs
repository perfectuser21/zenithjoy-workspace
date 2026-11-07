// Test-only physical media inputs. Production loaders never read these variables.
import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
export function nativePhoneTestMediaBinary(kind){
 if(!['ffmpeg','ffprobe'].includes(kind))throw Error('NATIVE_PHONE_TEST_MEDIA_KIND');
 const requested=process.env['PREFLIGHT_TEST_'+kind.toUpperCase()+'_BIN']??execFileSync('/usr/bin/which',[kind],{encoding:'utf8',timeout:10000}).trim();
 if(!isAbsolute(requested)||/[\r\n]/.test(requested))throw Error('NATIVE_PHONE_TEST_MEDIA_PATH');
 const path=realpathSync(requested),st=lstatSync(path);
 if(!st.isFile()||(st.mode&0o022)||!(st.mode&0o111))throw Error('NATIVE_PHONE_TEST_MEDIA_EXECUTABLE');
 return path;
}
