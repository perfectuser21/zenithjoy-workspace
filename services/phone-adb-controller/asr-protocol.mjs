import {createHash} from 'node:crypto';
export function parseCompatibleTranscript(response){
 if(!response||typeof response!=='object'||response.code&&response.code!=='Success'&&response.code!=='SUCCESS')return '';
 for(const output of [response.output,response.output?.output]){
  if(typeof output?.text==='string'&&output.text.trim()&&!output.text.includes('[REDACTED]'))return output.text;
  if(typeof output?.sentence?.text==='string'&&output.sentence.text.trim()&&!output.sentence.text.includes('[REDACTED]'))return output.sentence.text;
 }
 return '';
}
/** The URL comes only from the frozen source capability; callers cannot supply one. */
function officialRequest(body,source){
 const messages=body?.input?.messages,content=messages?.[0]?.content,audio=content?.[0]?.audio;
 if(body?.model!=='qwen-audio-3.0-asr-flash'||messages?.length!==1||messages[0].role!=='user'||content?.length!==1||typeof audio!=='string'||!audio.startsWith('data:audio/wav;base64,')||body?.parameters?.format!=='wav')throw Error('ASR_REQUEST_SHAPE_UNVERIFIED');
 const encoded=audio.slice('data:audio/wav;base64,'.length),bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length!==source.bytes||createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('ASR_INPUT_CHANGED');
 return {...body,input:{...body.input,messages:[{...messages[0],content:[{type:'input_audio',input_audio:{data:source.url}}]}]}};
}
export async function transcribeCompatible(audio,{legacyAsr,source,apiKey,audit}){
 if(!source||typeof source.run!=='function'||typeof audit!=='function')throw Error('ASR_PRIVATE_SOURCE_REQUIRED');
 return source.run(audio,{audit,recover:parseCompatibleTranscript,perform:prepared=>legacyAsr.transcribeAudio(audio,{format:'wav',apiKey,httpPost:async(url,body,key)=>{
  const raw=await prepared.post(url,officialRequest(body,prepared),key),text=parseCompatibleTranscript(raw);
  if(!text)throw Error('ASR_TRANSCRIPT_UNVERIFIED');
  return {output:{output:{text}}};
 }})});
}
