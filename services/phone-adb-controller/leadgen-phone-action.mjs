// 101 collect预算与派发共用；其它流程命令、锁及既有限时保持。
import {join} from 'node:path';
import {discoveryCommandBudgetMs,discoveryTapBudgetMs} from './discovery-phone-scope.mjs';
export function createPhoneAction({env,state,profile,run,isLocked,isClosed,getScope,checked,nativeReceipt}){
  return async(command,...args)=>{
    const locked=isLocked(),scope=getScope();
    const ctl=env.DOUYIN_PHONE_ADB||join(env.HOME,'.local/bin/douyin-phone-adb');
    const discoveryCollect=env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'&&state.currentActivity==='collect_videos';
    if(discoveryCollect){
      if(isClosed())throw Error('DISCOVERY_PHONE_COLLECT_CLOSED');
      const required=(command==='tap-evidence'?discoveryTapBudgetMs:discoveryCommandBudgetMs(command))+(locked&&!['lock-refresh','lock-release'].includes(command)?discoveryCommandBudgetMs('lock-refresh'):0);
      if(!Number.isSafeInteger(state.budgetDeadline)||state.budgetDeadline-Date.now()<required)throw Error('budget_exhausted');
    }
    const control=(argv,opts)=>{
      const action=argv[argv[2]==='--lock-owner'?4:2];
      if(discoveryCollect){
        opts={...opts,maxDurationS:discoveryCommandBudgetMs(action)/1000};
        if(action==='tap-evidence'){
          if(state.budgetDeadline-Date.now()<discoveryTapBudgetMs)throw Error('budget_exhausted');
          opts.discoveryMinimumRemainingMs=discoveryTapBudgetMs;
        }
      }
      return scope?checked(scope.zsh,['-f',ctl,...argv],opts):checked(ctl,argv,opts);
    };
    if(!locked&&!['lock-acquire','preflight'].includes(command))throw Error('设备操作未持本批锁');
    if(locked&&!['lock-refresh','lock-release'].includes(command)){
      const held=await control(['--profile',profile,'lock-refresh',run],{receipt:nativeReceipt()});
      if(!held.startsWith('lock=refreshed'))throw Error('设备锁续期未确认');
    }
    const ownerArgs=['close-app','return-safe-desktop','current-video-link','native-audio-evidence','snapshot-evidence','ui-evidence'].includes(command)?['--lock-owner',run]:[];
    // 取链包含nonce、UI重抓、复制与归位；仍由bounded夹在活动剩余预算内。
    const receipt=nativeReceipt();
    return control(['--profile',profile,...ownerArgs,command,...args],
      {...(command==='current-video-link'?{maxDurationS:300}:command==='search-video-tab'?{maxDurationS:180}:command==='private-message-send'?{maxDurationS:480}:{}),receipt,discoveryLockRelease:command==='lock-release'});
  };
}
