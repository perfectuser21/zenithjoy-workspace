import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const script = new URL('../douyin-phone-adb', import.meta.url).pathname;
const fixture = new URL('./fixtures/video-detail-from-search.xml', import.meta.url).pathname;

test('open-video pauses an autoplaying detail before reading its UI and restores playback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-video-autoplay-'));
  try {
    writeFileSync(join(dir, 'registry.tsv'), 'legacy\tSER1\tANY-MODEL\t1200\t2664\n');
    writeFileSync(join(dir, 'state'), 'playing');
    const adb = join(dir, 'adb');
    writeFileSync(adb, `#!/usr/bin/env node
const fs=require('fs'),p=require('path');const d=process.env.FAKE_PHONE_DIR,a=process.argv.slice(2).join(' '),state=p.join(d,'state');
fs.appendFileSync(p.join(d,'calls'),a+'\\n');
if(a.includes('get-state'))console.log('device');
else if(a.includes('getprop'))console.log('ANY-MODEL');
else if(a.includes('dumpsys'))console.log('mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}');
else if(a.includes('am start'))fs.writeFileSync(state,'playing');
else if(a.includes('input keyevent 127'))fs.writeFileSync(state,'paused');
else if(a.includes('input keyevent 126'))fs.writeFileSync(state,'playing');
else if(a.includes('uiautomator dump')){
 const playing=fs.readFileSync(state,'utf8')==='playing';fs.appendFileSync(p.join(d,'dump-states'),playing?'playing\\n':'paused\\n');
 if(playing){console.error('ERROR: could not get idle state');process.exit(1);}
 fs.copyFileSync(process.env.FAKE_DETAIL_XML,p.join(d,'remote.xml'));
}else if(a.includes('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(a.includes('stat -c %s'))console.log(fs.existsSync(p.join(d,'remote.xml'))?fs.statSync(p.join(d,'remote.xml')).size:0);
else if(a.includes(' pull ')){const n=process.argv.indexOf('pull');if(process.argv[n+1].endsWith('.xml'))fs.copyFileSync(p.join(d,'remote.xml'),process.argv[n+2]);else fs.writeFileSync(process.argv[n+2],'png');}
`, {mode: 0o755});
    const r = spawnSync('zsh', [script, '--profile', 'legacy', 'open-video', '7681632828384394202', 'fresh-after-card-open'], {
      env: {...process.env, HOME: dir, DOUYIN_PHONE_REGISTRY: join(dir,'registry.tsv'), DOUYIN_ADB_BIN: adb,
        DOUYIN_SIPS_BIN: '/usr/bin/true', DOUYIN_PHONE_TMP_ROOT: join(dir,'tmp'), FAKE_PHONE_DIR: dir, FAKE_DETAIL_XML: fixture},
      encoding: 'utf8', timeout: 8000,
    });
    assert.equal(r.status, 0, `autoplay UI must not exhaust retries: ${r.stderr}; ${r.error?.code || ''}`);
    assert.match(r.stdout, /video_opened=1/);
    assert.equal(readFileSync(join(dir,'state'),'utf8'), 'playing');
    assert.ok(readFileSync(join(dir,'dump-states'),'utf8').trim().split('\n').every(s => s === 'paused'));
    assert.doesNotMatch(readFileSync(join(dir,'calls'),'utf8'), /input tap|input keyevent 85/);
  } finally {rmSync(dir, {recursive:true, force:true});}
});
