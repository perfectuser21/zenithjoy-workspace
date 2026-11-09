export async function fetchBrainAuthorityGet(url,{headers,timeoutMs,fetcher=globalThis.fetch}){
 const target=String(url),deadline=Date.now()+timeoutMs,signal=AbortSignal.timeout(timeoutMs);
 const options={method:'GET',headers:{...headers},redirect:'error',signal};
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetcher(target,options);
   signal.throwIfAborted();
   if(Date.now()>=deadline)throw new DOMException('Authority read timed out','TimeoutError');
   return response;
  }catch(error){
   const cause=error instanceof TypeError?Object.getOwnPropertyDescriptor(error,'cause')?.value:null;
   if(attempt!==0||Object.getOwnPropertyDescriptor(cause||{},'code')?.value!=='UND_ERR_SOCKET'||signal.aborted||Date.now()>=deadline)throw error;
  }
 }
}
