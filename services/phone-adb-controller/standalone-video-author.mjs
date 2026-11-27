import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readEvidence} from './standalone-comment-observer.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{const code='STANDALONE_COLLECTION_AUTHOR_UNVERIFIED';throw Object.assign(Error(code),{code});};

export const authorXmlReader=String.raw`
import json, re, sys, xml.etree.ElementTree as ET
package = 'com.ss.android.ugc.aweme'
raw = sys.stdin.read(4194305)
if len(raw) > 4194304 or re.search(r'<!\s*(DOCTYPE|ENTITY)', raw, re.I):
    sys.exit(2)
root = ET.fromstring(raw)
if root.tag != 'hierarchy':
    sys.exit(2)
nodes = [n.attrib for n in root.iter('node') if n.get('package') == package]
if sys.argv[1] == 'detail':
    authors = [
        node for node in nodes
        if node.get('resource-id') == package + ':id/title'
        and node.get('class') == 'android.widget.TextView'
        and node.get('clickable') == 'true'
        and node.get('enabled') == 'true'
        and len(node.get('text', '').removeprefix('@').strip()) > 0
        and node.get('text', '').startswith('@')
    ]
    if len(authors) != 1:
        sys.exit(2)
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', authors[0].get('bounds', ''))
    if not match:
        sys.exit(2)
    x1, y1, x2, y2 = map(int, match.groups())
    if not (x1 < x2 and y1 < y2):
        sys.exit(2)
    print(json.dumps(dict(x=(x1+x2)//2, y=(y1+y2)//2)))
elif sys.argv[1] == 'profile':
    values = [n.get('text', '').removeprefix('抖音号：').strip() for n in nodes
              if n.get('text', '').startswith('抖音号：')]
    foreign = any(n.get('content-desc') == '私信' for n in nodes)
    own = any(n.get('text') == '编辑主页' or n.get('content-desc', '').startswith('切换账号') for n in nodes)
    if len(values) != 1 or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}', values[0]) or foreign == own:
        sys.exit(2)
    print(json.dumps(dict(douyin_id=values[0])))
else:
    sys.exit(2)
`;

export function createVideoAuthorReader({scope,evidenceRoot,runDirectory,python,phone,execute}){
  const call=(command,args)=>phone({command,args,profile:scope.profile,owner:scope.run_tag});
  return async videoId=>{
    if(!/^[0-9]{16,24}$/.test(videoId)||!python?.path||realpathSync(python.path)!==python.path
      ||sha(readFileSync(python.path))!==python.sha256)fail();
    const prefix=scope.run_tag+'-author-'+randomUUID().slice(0,8);
    async function verifyVideo(eid){
      const {stdout}=await call('current-video-link',[eid]);
      const ids=[...stdout.matchAll(/^video_id=(\d+)$/gm)];
      if(ids.length!==1||ids[0][1]!==videoId||!/^content_type=video$/m.test(stdout))fail();
    }
    async function capture(suffix,kind){
      const eid=prefix+'-'+suffix,{stdout}=await call('ui-evidence',[eid]);
      const xml=readEvidence({evidenceRoot,path:stdout.trim(),basename:eid+'.xml',start:scope.run_start_ts});
      const parsed=await execute(python.path,['-c',authorXmlReader,kind],{
        input:xml,timeoutMs:5000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},
      });
      if(parsed.code!==0)fail();
      return {...JSON.parse(parsed.stdout),xml,evidence:{file:eid+'.xml',sha256:sha(xml)}};
    }
    await verifyVideo(prefix+'-video');
    const detail=await capture('detail','detail');
    await call('tap-evidence',[detail.x,detail.y,prefix+'-tap',800]);
    let author;
    try{author=await capture('profile','profile');}
    finally{await call('back-evidence',[prefix+'-back']);}
    await verifyVideo(prefix+'-returned');
    const proofDirectory='standalone-author-evidence';
    if(runDirectory) {
      const output=join(runDirectory,proofDirectory);
      mkdirSync(output,{recursive:true,mode:0o700});
      if(realpathSync(output)!==output)fail();
      for(const proof of [detail,author]){
        writeFileSync(join(output,proof.evidence.file),proof.xml,{flag:'wx',mode:0o600});
        proof.evidence.file=proofDirectory+'/'+proof.evidence.file;
      }
    }
    return {video_id:videoId,douyin_id:author.douyin_id,detail:detail.evidence,profile:author.evidence};
  };
}
