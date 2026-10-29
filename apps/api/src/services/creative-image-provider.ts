export interface CreativeImageProvider {
  configured(): boolean;
  submit(prompt: string): Promise<string>;
  poll(id: string): Promise<{status:'pending'|'succeeded'|'failed';url?:string}>;
}
export class ToApisImageProvider implements CreativeImageProvider {
  configured() { return Boolean(process.env.TOAPI_API_KEY?.trim()); }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.configured()) throw Object.assign(new Error('图片生成服务尚未配置'),{status:503});
    let response: Response;
    try { response=await fetch(`https://toapis.com/v1/images/generations${path}`,{...init,headers:{Authorization:`Bearer ${process.env.TOAPI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),redirect:'error'}); }
    catch { throw Object.assign(new Error('图片服务连接失败，请先检查任务记录'),{status:502}); }
    if (!response.ok) throw Object.assign(new Error('图片服务暂时不可用'),{status:502});
    try { return await response.json() as Record<string, any>; } catch { throw Object.assign(new Error('图片服务返回无效数据'),{status:502}); }
  }
  async submit(prompt: string) {
    const body=await this.request('',{method:'POST',body:JSON.stringify({model:'gpt-image-2',prompt,n:1,size:'1:1',resolution:'1k',response_format:'url'})});
    if(typeof body.id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(body.id)) throw Object.assign(new Error('图片服务未返回有效任务编号'),{status:502});
    return body.id as string;
  }
  async poll(id: string) {
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw Object.assign(new Error('图片任务编号无效'),{status:502});
    const body=await this.request(`/${encodeURIComponent(id)}`);
    if(body.status==='completed') {const url=body.result?.data?.[0]?.url??body.url;if(typeof url!=='string') throw Object.assign(new Error('图片服务未返回图片'),{status:502});return {status:'succeeded' as const,url};}
    if(['failed','canceled'].includes(body.status)) return {status:'failed' as const};
    if(['queued','pending','in_progress','processing'].includes(body.status)) return {status:'pending' as const};
    throw Object.assign(new Error('图片服务任务状态无法识别'),{status:502});
  }
}
