import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../native-phone-command-source.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../native-phone-command-source.mjs',import.meta.url).href)return {};throw error;});
const context={profile:'fixture',serial:'47.100.213.173:10001',width:720,height:1280,keywords:['人工智能'],package:'com.ss.android.ugc.aweme'};
test('parent compiles only fixed finite native commands, including the original explicit MEDIA_PAUSE',()=>{
 assert.equal(typeof api.compileNativePhoneCommand,'function');
 assert.equal(api.compileNativePhoneCommand('pause',[],context),"exec /system/bin/input 'keyevent' '127'");
 assert.equal(api.compileNativePhoneCommand('dump',[],context),"exec /system/bin/uiautomator 'dump' '--compressed' '/sdcard/douyin-leadgen-ui-fixture.xml'");
 assert.equal(api.compileNativePhoneCommand('tap',['120','340'],context),"exec /system/bin/input 'tap' '120' '340'");
 assert.equal(api.compileNativePhoneCommand('search',[encodeURIComponent('人工智能')],context),"exec /system/bin/am 'start' '-a' 'android.intent.action.VIEW' '-d' 'snssdk1128://search/tabs?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD'");
 for(const [op,args] of [['shell',['id']],['exec',['/bin/sh']],['pause',['85']],['tap',['-1','300']],['tap',['721','300']],['tap',['1;id','2']],['search',[encodeURIComponent('别家公司')]],['dump',['/sdcard/window_dump.xml']],['search',["a'$(id)"]]])assert.throws(()=>api.compileNativePhoneCommand(op,args,context),/NATIVE_PHONE_COMMAND/);
});
test('command text is not command-source or remote-stop authority',()=>{
 assert.equal(typeof api.compileNativePhoneCommand,'function');
 const command=api.compileNativePhoneCommand('dump',[],context);assert.equal(typeof command,'string');
 assert.equal(typeof api.readNativePhoneCommandSource,'function');
 assert.throws(()=>api.readNativePhoneCommandSource({verified:true,command,execution_stopped:true}),/NATIVE_PHONE_COMMAND_SOURCE/);
});

test('finite original preflight and UI commands retain exact target and no shell input',()=>{
 const id='/sdcard/preflight-12345678-1234-4234-8234-123456789abc.xml';
 for(const [op,args,expected] of [
  ['model',[],"exec /system/bin/getprop 'ro.product.model'"],
  ['telecom',[],"exec /system/bin/dumpsys 'telephony.registry'"],
  ['window',[],"exec /system/bin/dumpsys 'window'"],
  ['wake',[],"exec /system/bin/input 'keyevent' '224'"],
  ['unlock',[],"exec /system/bin/wm 'dismiss-keyguard'"],
  ['open-app',[],"exec /system/bin/monkey '-p' 'com.ss.android.ugc.aweme' '-c' 'android.intent.category.LAUNCHER' '1'"],
  ['dump-file',[id],"exec /system/bin/uiautomator 'dump' '"+id+"'"],
  ['stat-ui-mtime',[],"exec /system/bin/toybox 'stat' '-c' '%Y' '/sdcard/douyin-leadgen-ui-fixture.xml'"],
  ['ui-exists',[],"exec /system/bin/toybox 'test' '-e' '/sdcard/douyin-leadgen-ui-fixture.xml'"],
  ['ui-symlink',[],"exec /system/bin/toybox 'test' '-L' '/sdcard/douyin-leadgen-ui-fixture.xml'"],
  ['device-date',[],"exec /system/bin/toybox 'date' '+%s'"],
  ['keyevent',['85'],"exec /system/bin/input 'keyevent' '85'"]
 ])assert.equal(api.compileNativePhoneCommand(op,args,context),expected);
 for(const [op,args] of [['dump-file',['/sdcard/foreign.xml']],['dump-file',[id+'.png']],['open-app',['foreign']],['screenshot-file',[id]],['model',['ro.secret']],['keyevent',['225']],['device-date',['$(id)']]])assert.throws(()=>api.compileNativePhoneCommand(op,args,context),/NATIVE_PHONE_COMMAND/);
});

test('102 read-only audio observation compiles only the original finite service queries',()=>{
 for(const [op,args,expected] of [
  ['media-session',[],"exec /system/bin/dumpsys 'media_session'"],
  ['audio-dump',[],"exec /system/bin/dumpsys 'audio'"],
  ['package-uid',[],"exec /system/bin/cmd 'package' 'list' 'packages' '-U' 'com.ss.android.ugc.aweme'"],
  ['uid-owners',['10123'],"exec /system/bin/cmd 'package' 'list' 'packages' '-U' '--uid' '10123'"]
 ])assert.equal(api.compileNativePhoneCommand(op,args,context),expected);
 for(const [op,args] of [['media-session',['volume']],['audio-dump',['--reset']],['package-uid',['other.app']],['uid-owners',['0']],['uid-owners',['-1']],['uid-owners',['10123;id']],['uid-owners',['10123','other.app']],['uid-owners',['999999999999999999999']]])assert.throws(()=>api.compileNativePhoneCommand(op,args,context),/NATIVE_PHONE_COMMAND/);
});

test('recording volume check compiles only the original read-only media stream query',()=>{
 assert.equal(api.compileNativePhoneCommand('media-volume',[],context),"exec /system/bin/cmd 'media_session' 'volume' '--stream' '3' '--get'");
 for(const args of [['--set','1'],['--stream','0'],['$(id)']])assert.throws(()=>api.compileNativePhoneCommand('media-volume',args,context),/NATIVE_PHONE_COMMAND/);
});
