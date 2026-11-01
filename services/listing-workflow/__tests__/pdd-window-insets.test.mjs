import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const file=new URL('../pdd-window-insets.py',import.meta.url).pathname;
const raw=`  Window #1 Window{abc u0 StatusBar}:
    mDisplayId=0 rootTaskId=1
    mOwnerUid=10081 package=com.android.systemui
    mAttrs={(0,0)(fillx121) ty=STATUS_BAR
        InsetsFrameProvider: {type=statusBars, source=FRAME}
    mFullConfiguration={ mDisplayRotation=ROTATION_0 }
    mHasSurface=true isReadyForDisplay()=true
    Frames: parent=[0,0][1200,2664] display=[0,0][1200,2664] frame=[0,0][1200,121] last=[0,0][1200,121]
    isVisible=true
  Window #2 Window{def u0 NotificationShade}:
    mHasSurface=false isReadyForDisplay()=false
    isVisible=false
`;
function run(text=raw,target=[10,800,110,900]){const script=`import pathlib,json\nh={};exec(pathlib.Path(${JSON.stringify(file)}).read_text(),h)\ntry:\n p=h['parse_status_bar'](${JSON.stringify(text)},{'width':1200,'height':2664});print(json.dumps(h['agree_status_bar'](p,p,${JSON.stringify(target)},[800,750,900,850])))\nexcept Exception as e:print(json.dumps({'error':str(e)}))`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('derives only a visible native top statusBars rectangle on the bound primary portrait display',()=>{assert.deepEqual(run(),[0,0,1200,121]);});
for(const [name,text]of Object.entries({missing:'',dimensions:raw.replaceAll('[1200,2664]','[1201,2664]'),big:raw.replaceAll('[1200,121]','[1200,800]'),side:raw.replaceAll('[0,0][1200,121]','[100,0][1200,121]'),rotation:raw.replace('ROTATION_0','ROTATION_90'),display:raw.replace('mDisplayId=0','mDisplayId=1'),shade:raw.replace('mHasSurface=false','mHasSurface=true').replace('isVisible=false','isVisible=true'),duplicate:raw+raw}))test(`${name} status bar evidence is refused`,()=>assert.match(run(text).error,/STATUS_BAR|NOTIFICATION/));
test('a native statusBar exemption cannot intersect the approved app target',()=>assert.match(run(raw,[10,50,110,100]).error,/OVERLAP/));
