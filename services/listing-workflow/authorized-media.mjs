import{readFileSync,statSync}from'node:fs';
import{resolve}from'node:path';
import{createHash}from'node:crypto';
import{spawnSync}from'node:child_process';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=/^[a-f0-9]{64}$/;
function authorization(config){
 const auth=config.materials;
 if(!auth||!hex.test(auth.manifestSha256||'')||!hex.test(auth.sourceZipSha256||'')||typeof auth.manifestPath!=='string')throw new Error('MATERIAL_AUTHORIZATION_REQUIRED');
 const manifestBytes=readFileSync(auth.manifestPath);
 if(sha(manifestBytes)!==auth.manifestSha256)throw new Error('MATERIAL_MANIFEST_CHANGED');
 const manifest=JSON.parse(manifestBytes);
 if(manifest.sourceZipSha256!==auth.sourceZipSha256||typeof manifest.sourceZip!=='string'||!Array.isArray(manifest.assets)||!manifest.assets.length||manifest.assets.length>50)throw new Error('INVALID_MATERIAL_MANIFEST');
 if(statSync(manifest.sourceZip).size>256*1024*1024)throw new Error('AUTHORIZED_ZIP_TOO_LARGE');
 const zip=readFileSync(manifest.sourceZip);
 if(sha(zip)!==auth.sourceZipSha256)throw new Error('AUTHORIZED_SOURCE_ZIP_CHANGED');
 for(const asset of manifest.assets)if(typeof asset.path!=='string'||typeof asset.archiveName!=='string'||!hex.test(asset.sha256||''))throw new Error('INVALID_MATERIAL_MANIFEST');
 const program=`import io,sys,zipfile,hashlib,json
names=json.loads(sys.argv[1]);z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));answer={};total=0
def names_for(name):
 try:return [name,name.encode('cp437').decode('utf8')]
 except (UnicodeError,ValueError):return [name]
for name in names:
 matches=[i for i in z.infolist() if name in names_for(i.filename)]
 if len(matches)!=1 or matches[0].file_size>20*1024*1024 or matches[0].is_dir():raise ValueError('MEMBER_NOT_UNIQUE_OR_TOO_LARGE')
 total+=matches[0].file_size
 if total>256*1024*1024:raise ValueError('MATERIAL_SET_TOO_LARGE')
 answer[name]=hashlib.sha256(z.read(matches[0])).hexdigest()
print(json.dumps(answer))
`;
 const result=spawnSync('python3',['-c',program,JSON.stringify(manifest.assets.map(x=>x.archiveName))],{input:zip,maxBuffer:1024*1024,timeout:20000});
 if(result.status!==0||result.error)throw new Error('AUTHORIZED_ARCHIVE_UNVERIFIED');
 const archived=JSON.parse(result.stdout.toString());
 if(manifest.assets.some(x=>archived[x.archiveName]!==x.sha256))throw new Error('MANIFEST_MEMBER_HASH_CONFLICT');
 return{manifest,auth};
}
export function materialPolicy(config){
 const{manifest,auth}=authorization(config);
 return Object.freeze({sourceZipSha256:auth.sourceZipSha256,manifestSha256:auth.manifestSha256,allowedDigests:Object.freeze([...new Set(manifest.assets.map(x=>x.sha256))])});
}
export function authorizedImageBytes(config,image){
 const{manifest}=authorization(config);
 const matches=manifest.assets.filter(x=>typeof image.path==='string'&&resolve(x.path)===resolve(image.path)&&x.sha256===image.sha256);
 if(matches.length!==1)throw new Error('MATCHED_MANIFEST_ASSET_REQUIRED');
 const bytes=image.bytesBase64?Buffer.from(image.bytesBase64,'base64'):readFileSync(matches[0].path);
 if(sha(bytes)!==matches[0].sha256)throw new Error('MATERIAL_ASSET_CHANGED');
 return bytes;
}
