import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';

// Run discovery from the same admitted host actions as the Agent implementation.
// invoke must read the durable receipt when the host abbreviated its stdout.
export async function runLightweightDiscovery101({context,workDir,invoke,hostRoot,pause=sleep}) {
  const {run_tag:runTag,profile,serial,line,keyword,search_filters:filters,max_candidates:maxCandidates} = context;
  const identity = context.tasks?.['101'];
  if(context.assigned_workflow!=='101'||identity?.run_id!==runTag||identity?.run_tag!==runTag
    ||!identity?.task_id||!Number.isSafeInteger(context.business_deadline_ms)||Date.now()>=context.business_deadline_ms)
    throw Error('LIGHT101_RUN_SCOPE');
  if(!filters||['sort','time_layer','duration','scope','location'].some(key=>typeof filters[key]!=='string'))
    throw Error('LIGHT101_FILTERS_INCOMPLETE');

  let sequence=0,unknown=false;
  const handoffs=new Map(),itemEvidence=new Map(),runEvidence={};
  let videoPage,grid,filtersReceipt,linkReceipt;
  const useHost=async(kind,args)=>{
    if(unknown)throw Error('LIGHT101_PRIOR_ACTION_UNKNOWN');
    const name='light101-'+String(++sequence).padStart(5,'0');
    let receipt;
    try{receipt=await invoke(kind,name,args);}
    catch{unknown=true;throw Error('LIGHT101_HOST_ACTION_UNKNOWN');}
    if(receipt?.state!=='terminal'||receipt.binding?.activity!=='collect_videos'
      ||receipt.binding.kind!==kind||JSON.stringify(receipt.binding.args)!==JSON.stringify(args)
      ||['task_id','run_id','run_tag'].some(key=>receipt.binding.identity?.[key]!==identity[key])
      ||!Number.isInteger(receipt.result?.exit_code)){
      unknown=true;
      throw Error('LIGHT101_HOST_RECEIPT_UNBOUND');
    }
    if(receipt.result.exit_code!==0)throw Error('LIGHT101_HOST_ACTION_FAILED');
    return {name,result:receipt.result};
  };
  const deadline=()=>context.business_deadline_ms;
  const business=async(op,input)=>{
    const {name,result}=await useHost('business',[JSON.stringify({
      op,...input,line,run:runTag,...(op==='discover_readback'?{include_handoff:true}:{}),
    })]);
    const output=JSON.parse(result.stdout);
    if(output.ok!==true)throw Error('LIGHT101_PG_ACTION_FAILED');
    return {name,data:output.result};
  };
  const field=(stdout,key)=>stdout?.split('\n').find(line=>line.startsWith(key+'='))?.slice(key.length+1).trim();
  const receiptPath=name=>{
    const relative='receipts/'+name+'.json',file=join(hostRoot,relative);
    if(realpathSync(file)!==file||!lstatSync(file).isFile())throw Error('LIGHT101_EVIDENCE_MISSING');
    return relative;
  };
  const fetchNative=async(file)=>{
    const remote=basename(file??'');
    if(!file||dirname(file)!==context.native_root||!remote.startsWith(runTag+'-'))throw Error('LIGHT101_EVIDENCE_SCOPE');
    const {result}=await useHost('fetch-native',[remote]);
    const relative='native/'+remote,saved=join(hostRoot,relative);
    if(result.data?.path!==saved||result.data.remote_name!==remote||realpathSync(saved)!==saved
      ||!lstatSync(saved).isFile()||createHash('sha256').update(readFileSync(saved)).digest('hex')!==result.data.sha256)
      throw Error('LIGHT101_EVIDENCE_MISSING');
    return relative;
  };
  const executor=createDiscoveryHandlers({
    run:runTag,runId:identity.run_id,profile,sourceCommit:context.source_commit,sources:[keyword],
    limit:maxCandidates,location:filters.location,searchFilters:filters,budgetDeadline:deadline,
    discoveryInput:{
      schema_version:2,workflow_key:'douyin_video_discovery',run_tag:runTag,profile,serial,line,
      max_attempts:maxCandidates,max_screens:1,source_kind:'keyword',sources:[keyword],
      source_sha256:createHash('sha256').update(keyword+'\n').digest('hex'),
    },
    env:{
      WFR_RUN_DIR:workDir,SERIAL:serial,LEADGEN_LINE:line,LEADGEN_EVIDENCE_DIR:context.native_root,
      LEADGEN_MAX_SCREENS:'1',
    },
    phone:async(command,...args)=>{
      const receipt=await useHost('phone',[command,...args]),{stdout}=receipt.result;
      if(command==='search-video-tab')videoPage=field(stdout,'evidence');
      if(command==='search-video-cards')grid=field(stdout,'evidence');
      if(command==='search-time-layer')filtersReceipt=receipt;
      if(command==='current-video-link')linkReceipt=receipt;
      return stdout;
    },
    execute:async(_command,[seconds])=>{
      const waitMs=1000*Number(seconds);
      if(Date.now()+waitMs>=deadline())throw Error('budget_exhausted');
      await pause(waitMs);
      return {code:0};
    },
    queue:async(_op,{video})=>{
      const exact={video_ids:[video.videoId],include_discovery_protection:true};
      let nativeEvidence;
      if(hostRoot){
        const link=linkReceipt.result.stdout;
        const linkId=field(link,'metrics_evidence_id'), copied=field(link,'evidence');
        if(field(link,'video_id')!==video.videoId||field(link,'resolved_url')!==video.videoUrl
          ||!linkId?.startsWith(runTag+'-')||!/^[A-Za-z0-9_-]+$/.test(linkId))
          throw Error('LIGHT101_LINK_RECEIPT_UNBOUND');
        const shareXml=await fetchNative(field(link,'metrics_evidence'));
        if(basename(copied??'')!==linkId+'-link-copied.png')throw Error('LIGHT101_EVIDENCE_SCOPE');
        const copyScreen=await fetchNative(copied);
        const pasteXml=await fetchNative(join(context.native_root,linkId+'-scratch-result.xml'));
        const reopened=await useHost('phone',['open-video',video.videoId,linkId+'-reopen']);
        if(field(reopened.result.stdout,'video_opened')!=='1'||field(reopened.result.stdout,'video_id')!==video.videoId)
          throw Error('LIGHT101_REOPEN_UNVERIFIED');
        nativeEvidence={share_xml:shareXml,copy_screen:copyScreen,paste_xml:pasteXml,
          link_receipt:receiptPath(linkReceipt.name),reopen_receipt:receiptPath(reopened.name)};
      }
      const prior=hostRoot&&await business('inspect_videos',exact);
      const written=await business('discover',{video});
      const observed=await business('discover_readback',{video}),confirmed=observed.data;
      if(confirmed?.metrics_verified!==true||confirmed.metrics_digest!==video.metrics.digest
        ||confirmed.handoff?.video_id!==video.videoId||confirmed.handoff.video_url!==video.videoUrl)
        throw Error('LIGHT101_PG_READBACK_FAILED');
      handoffs.set(video.videoId,{...confirmed.handoff,author:video.author});
      if(hostRoot){
        const after=await business('inspect_videos',exact);
        itemEvidence.set(video.videoId,{
          ...nativeEvidence,write_receipt:receiptPath(written.name),
          readback_receipt:receiptPath(observed.name),prior_state:receiptPath(prior.name),written_state:receiptPath(after.name),
        });
      }
      return written.data;
    },
  });
  const result=await executor.collect_videos().then(result=>({...result,
    status:result.status??(result.videos.length?'completed':'empty'),
  })).catch(error=>{
    if(error.message!=='LIGHT101_HOST_ACTION_FAILED')throw error;
    return {status:'failed',stop_reason:'source_failed',all_results_scanned:false,
      failures:executor.state.failures,counts:executor.state.counts,videos:[]};
  });
  if(unknown)throw Error('LIGHT101_HOST_ACTION_UNKNOWN');
  if(hostRoot&&filtersReceipt){
    const filter=filtersReceipt.result.stdout;
    try{
      Object.assign(runEvidence,{filters_receipt:receiptPath(filtersReceipt.name),
        selected_page:await fetchNative(field(filter,'selected_evidence')),
        results_page:await fetchNative(field(filter,'results_evidence')),
        video_page_xml:await fetchNative(videoPage),cards_xml:await fetchNative(grid)});
    }catch(error){
      if(unknown)throw Error('LIGHT101_HOST_ACTION_UNKNOWN');
      return {...result,evidence_error:error.message};
    }
  }
  const videos=result.videos.map(video=>handoffs.get(video.videoId));
  if(videos.some(video=>!video)||hostRoot&&(!Object.keys(runEvidence).length
    ||result.videos.some(video=>!itemEvidence.has(video.videoId))))return {...result,evidence_error:'LIGHT101_EVIDENCE_MISSING'};
  return {...result,handoffs:videos,...(hostRoot?{delivery_evidence:{run:runEvidence,...Object.fromEntries(itemEvidence)}}:{})};
}
