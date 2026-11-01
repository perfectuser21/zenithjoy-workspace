import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const pixels=new URL('../pdd-native-pixels.py',import.meta.url).pathname;
const picker=new URL('../pdd-media-actions.py',import.meta.url).pathname;
const setup=String.raw`import pathlib,zlib,struct,json,base64,hashlib,types
h={'__name__':'test','base64':base64}
exec(pathlib.Path(${JSON.stringify(pixels)}).read_text(),h)
exec(pathlib.Path(${JSON.stringify(picker)}).read_text(),h)
h['sha']=lambda raw:hashlib.sha256(raw).hexdigest()
def png(data,mode=0):
 w,height=6,8;stride=w*4;prior=bytes(stride);rows=[]
 for y in range(height):
  row=data[y*stride:(y+1)*stride];out=[]
  for i,v in enumerate(row):
   left=row[i-4] if i>=4 else 0;up=prior[i];corner=prior[i-4] if i>=4 else 0
   p=left+up-corner;dist=[abs(p-left),abs(p-up),abs(p-corner)]
   prediction=[0,left,up,(left+up)//2,[left,up,corner][dist.index(min(dist))]][mode]
   out.append((v-prediction)&255)
  rows.append(bytes([mode])+bytes(out));prior=row
 def chunk(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
data=bytes((i*7)%256 for i in range(6*8*4))
config={'binding':{'width':6,'height':8}}
selected=[{'caption':str(i),'bounds':[i%3*2,i//3*2,i%3*2+2,i//3*2+2]} for i in range(12)]
p=types.SimpleNamespace(selected=lambda:[dict(x) for x in selected])
def frame(raw):return {'path':'same-path.png','sha256':hashlib.sha256(raw).hexdigest(),'bytesBase64':base64.b64encode(raw).decode()}
`;
function run(body){const r=spawnSync('python3',['-c',setup+body],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('a selected frame decodes once while preserving every crop digest for all PNG filters',()=>{
 const r=run(`original=h['png_rgba'];count=[0]
def counted(*a,**k):count[0]+=1;return original(*a,**k)
h['png_rgba']=counted
out=[]
for mode in range(5):
 raw=png(data,mode);expected=[h['png_crop_sha'](raw,x['bounds'],expected_size=[6,8]) for x in selected];count[0]=0
 actual=h['picker_selected'](config,p,frame(raw))
 assert [x['cropSha256'] for x in actual]==expected
 out.append(count[0])
print(json.dumps(out))`);assert.deepEqual(r,[1,1,1,1,1]);
});
test('decoded immutable pixels preserve masks and reject dimensions, invalid crops and mutable data',()=>{
 const r=run(`f=h['crop_sha_from_rgba'];raw=png(data);decoded=h['png_rgba'](raw,expected_size=[6,8]);cases=[]
for bounds,masks in [([0,0,6,8],[]),([0,0,6,8],[[2,1,4,4]]),([1,1,3,5],[[0,0,2,3]])]:assert f(decoded,bounds,masks)==h['png_crop_sha'](raw,bounds,masks,expected_size=[6,8])
for value,bounds,masks in [(decoded,[0,0,7,8],[]),(decoded,[True,0,1,1],[]),(decoded,[0,0,6,8],[[0,0,7,1]]),((6,8,bytearray(data)),[0,0,1,1],[]),((6,9,data),[0,0,1,1],[])]:
 try:f(value,bounds,masks)
 except ValueError:cases.append(True)
 else:cases.append(False)
print(json.dumps(cases))`);assert.deepEqual(r,[true,true,true,true,true]);
});
test('same path with new bytes is decoded anew; SHA, CRC and exact dimensions still fail closed',()=>{
 const r=run(`a=png(data);changed=bytearray(data);changed[0]^=1;b=png(bytes(changed));one=h['picker_selected'](config,p,frame(a));two=h['picker_selected'](config,p,frame(b));assert one[0]['cropSha256']!=two[0]['cropSha256'];assert [x['cropSha256'] for x in one[1:]]==[x['cropSha256'] for x in two[1:]]
errors=[]
for c,f in [(config,dict(frame(a),sha256='0'*64)),(config,frame(a[:-1]+b'!')),({'binding':{'width':7,'height':8}},frame(a))]:
 try:h['picker_selected'](c,p,f)
 except ValueError:errors.append(True)
 else:errors.append(False)
assert h['picker_selected'](config,types.SimpleNamespace(selected=lambda:[]),{'bytesBase64':''})==[]
print(json.dumps(errors))`);assert.deepEqual(r,[true,true,true]);
});
