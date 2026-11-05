import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:net';import {createHash} from 'node:crypto';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const free=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
export async function privatePgSsh(t){
 const directory=mkdtempSync(join(tmpdir(),'preflight-pg-ssh-')),owned=[],beforeStop=[];let teardown=false;
 const stop=async()=>{if(teardown)return;teardown=true;for(const dispose of beforeStop)await dispose();for(const p of owned.reverse()){if(p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');await new Promise(r=>p.once('close',r));}}rmSync(directory,{recursive:true,force:true});};t.after(stop);
 const pgPort=await free(),sshPort=await free(),pgbin=process.env.PREFLIGHT_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
 execFileSync(join(pgbin,'initdb'),['-D',join(directory,'pg'),'-A','trust','-U','preflight_fixture','--no-locale'],{stdio:'ignore'});
 const start=(program,args)=>{const p=spawn(program,args,{stdio:['ignore','ignore','pipe']});p.log='';p.stderr.on('data',b=>p.log+=b);owned.push(p);return p;};
 const pg=start(join(pgbin,'postgres'),['-D',join(directory,'pg'),'-h','127.0.0.1','-p',String(pgPort),'-k',directory]);
 for(let i=0;!pg.log.includes('ready to accept connections');i++){if(i>100||pg.exitCode!==null)throw Error('PRIVATE_PG_START_FAILED');await pause(20);}
 for(const name of ['host','identity'])execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-f',join(directory,name)]);
 writeFileSync(join(directory,'authorized_keys'),readFileSync(join(directory,'identity.pub')),{mode:0o600});
 writeFileSync(join(directory,'sshd_config'),`ListenAddress 127.0.0.1\nPort ${sshPort}\nHostKey ${directory}/host\nPidFile ${directory}/sshd.pid\nAuthorizedKeysFile ${directory}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nAllowTcpForwarding local\nPermitOpen 127.0.0.1:${pgPort}\nLogLevel ERROR\n`);
 const sshd=start('/usr/sbin/sshd',['-D','-e','-f',join(directory,'sshd_config')]);await pause(100);if(sshd.exitCode!==null)throw Error('PRIVATE_SSHD_START_FAILED:'+sshd.log);
 writeFileSync(join(directory,'known_hosts'),'preflight_fixture '+readFileSync(join(directory,'host.pub'),'utf8'),{mode:0o600});
 const publicFingerprint=path=>'SHA256:'+createHash('sha256').update(Buffer.from(readFileSync(path,'utf8').trim().split(/\s+/)[1],'base64')).digest('base64').replace(/=+$/,'');
 const policy={host_key_kind:'ssh-ed25519',host_key_fingerprint:publicFingerprint(join(directory,'host.pub')),ssh_bin:'/usr/bin/ssh',ssh_sha256:sha('/usr/bin/ssh'),hostname:'127.0.0.1',hostkey_alias:'preflight_fixture',port:sshPort,user:process.env.USER,identity:join(directory,'identity'),identity_sha256:sha(join(directory,'identity')),known_hosts:join(directory,'known_hosts'),known_hosts_sha256:sha(join(directory,'known_hosts')),pg_port:pgPort};
 const otherHost=async()=>{const port=await free(),key=join(directory,'other-host');execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-f',key]);const config=join(directory,'other-sshd-config');writeFileSync(config,readFileSync(join(directory,'sshd_config'),'utf8').replace('Port '+sshPort,'Port '+port).replace('HostKey '+directory+'/host','HostKey '+key).replace('PidFile '+directory+'/sshd.pid','PidFile '+directory+'/other-sshd.pid'));const child=start('/usr/sbin/sshd',['-D','-e','-f',config]);await pause(100);if(child.exitCode!==null)throw Error('PRIVATE_OTHER_SSHD_START_FAILED');return {port,publicKey:readFileSync(key+'.pub','utf8').trim()};};
 return {directory,policy,otherHost,beforeStop:fn=>beforeStop.push(fn),connection:{user:'preflight_fixture',database:'postgres',host:'127.0.0.1',port:pgPort},stop};
}
