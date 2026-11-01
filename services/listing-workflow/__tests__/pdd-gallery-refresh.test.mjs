import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const host=new URL('../controller-host.py',import.meta.url).pathname;
const native=new URL('../pdd-native-host.py',import.meta.url).pathname;
function run(body){const script=`import pathlib,json,tempfile,types
h={'__name__':'test'}
exec(pathlib.Path(${JSON.stringify(host)}).read_text(),h)
exec(pathlib.Path(${JSON.stringify(native)}).read_text(),h)
with tempfile.TemporaryDirectory() as root:
 c={'owner':'owner','remoteRoot':root,'ownedMedia':[{'mediaId':'8018','sha256':'a'*64,'phonePath':'/sdcard/run.jpg'}],'phoneAlbum':{'verified':True},'galleryEntries':[{'jobId':'initial'}],'limitedGrant':{'confirmIntent':{'jobId':'grant'}},'draft':{'owned':True,'owner':'owner','formWindow':'owned-window','values':{'title':'R14'}}}
 h['phone_readback']=lambda c:{'ok':True}
 screen=types.SimpleNamespace(field=lambda k:{'value':{'title':'R14','groupPrice':'','inventory':'1'}[k]})
 c['lastForegroundRaw']='owned-window'
 ${body.replaceAll('\n','\n ')}
`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('one refresh intent persists before leaving, and a repeated refresh cannot be sent',()=>{const r=run(`h['begin_gallery_refresh'](c,'back-once')
assert json.loads((pathlib.Path(root)/'config.json').read_text())['galleryRefresh']['intentJobId']=='back-once'
try:h['begin_gallery_refresh'](c,'repeat')
except ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'GALLERY_REFRESH_ALREADY_ATTEMPTED');});
test('reentry requires both the same owned form and fresh source readback',()=>{const r=run(`h['begin_gallery_refresh'](c,'back-once')
errors=[]
for step in ['no-form','form-only','ready']:
 if step=='form-only':h['observe_gallery_refresh'](c,'form',screen,{'path':'form-proof'})
 if step=='ready':h['observe_gallery_refresh'](c,'source',screen,{'path':'source-proof'})
 try:h['record_gallery_entry'](c,'reentry')
 except ValueError as e:errors.append(str(e))
 else:errors.append('allowed')
try:h['record_gallery_entry'](c,'third')
except ValueError as e:errors.append(str(e))
print(json.dumps(errors))`);assert.deepEqual(r,['GALLERY_REFRESH_READBACK_REQUIRED','GALLERY_REFRESH_READBACK_REQUIRED','allowed','GALLERY_ENTRY_LIMIT']);});
for(const mode of ['window','value','media'])test(`refresh rejects changed ${mode} identity`,()=>{const r=run(`h['begin_gallery_refresh'](c,'back-once')
mode=${JSON.stringify(mode)}
if mode=='window':c['lastForegroundRaw']='other-window'
if mode=='value':screen=types.SimpleNamespace(field=lambda k:{'value':'changed'})
if mode=='media':c['ownedMedia'][0]['mediaId']='foreign'
try:
 h['observe_gallery_refresh'](c,'form',screen,{'path':'form-proof'})
 h['observe_gallery_refresh'](c,'source',screen,{'path':'source-proof'})
 h['record_gallery_entry'](c,'reentry')
except ValueError as e:print(json.dumps({'error':str(e)}))`);assert.match(r.error,/GALLERY_REFRESH_(FORM|MEDIA)_CHANGED/);});
test('refresh cannot start without a completed finite grant or after selecting an image',()=>{const r=run(`c['gallerySelection']=[{'mediaId':'8018'}]
try:h['begin_gallery_refresh'](c,'bad')
except ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'GALLERY_REFRESH_UNSAFE_STATE');});

test('a gallery reentry before the explicit refresh is refused without adding another intent',()=>{const r=run("try:h['record_gallery_entry'](c,'repeat')\nexcept ValueError as e:print(json.dumps({'error':str(e),'entries':len(c['galleryEntries'])}))");assert.deepEqual(r,{error:'GALLERY_REFRESH_READBACK_REQUIRED',entries:1});});
test('refresh without a completed grant has no durable intent',()=>{const r=run("c['limitedGrant']={}\ntry:h['begin_gallery_refresh'](c,'bad')\nexcept ValueError as e:print(json.dumps({'error':str(e),'intent':c.get('galleryRefresh')}))");assert.deepEqual(r,{error:'GALLERY_REFRESH_UNSAFE_STATE',intent:null});});
