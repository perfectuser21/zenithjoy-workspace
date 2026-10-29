import {mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

// CLI prepare fixtures need an exact, manifest-pinned 101 host template.
export function addDiscoveryCliScopeTemplate(root, manifest, {target,profile,serial}) {
 const path='config/collection-phone-hosts.json';
 mkdirSync(join(root,'config'),{recursive:true});
 const bytes=JSON.stringify({version:1,hosts:[{
  target,profile,serial,expected_account:'fixture-account',
  evidence_root:`/private/tmp/openclaw-phone/evidence/${profile}`,
  policy:{host_id:target},executables:{},workflow_keys:['douyin_video_discovery']
 }]});
 writeFileSync(join(root,path),bytes);
 manifest.files.push({path:'services/phone-adb-controller/'+path,deployed_path:path,
  content_sha256:createHash('sha256').update(bytes).digest('hex')});
 return manifest;
}
