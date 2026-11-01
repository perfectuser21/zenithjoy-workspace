import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const path=new URL('../pdd-native-pixels.py',import.meta.url).pathname;
test('an unrelated animation cannot change an exact target crop, while a target overlay does',()=>{
 const script=`import pathlib,zlib,struct,json\ng={'__name__':'test'}\nexec(pathlib.Path(${JSON.stringify(path)}).read_text(),g)\ndef png(pixels):\n def c(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v))\n return b'\\x89PNG\\r\\n\\x1a\\n'+c(b'IHDR',struct.pack('>IIBBBBB',3,2,8,6,0,0,0))+c(b'IDAT',zlib.compress(b'\\0'+bytes(pixels[:12])+b'\\0'+bytes(pixels[12:])))+c(b'IEND',b'')\na=[10]*24;b=a.copy();b[-1]=20;c=a.copy();c[0]=20\nf=g['png_crop_sha'];print(json.dumps({'same':f(png(a),[0,0,1,1])==f(png(b),[0,0,1,1]),'different':f(png(a),[0,0,1,1])!=f(png(c),[0,0,1,1])}))`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{same:true,different:true});
});
