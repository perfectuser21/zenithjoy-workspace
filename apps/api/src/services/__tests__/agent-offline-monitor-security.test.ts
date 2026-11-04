import {afterEach,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
vi.mock('../../db',()=>({default:{query:vi.fn().mockResolvedValue({rows:[]})}}));
import {sendOfflineAlert,sendRecoveryAlert} from '../agent-offline-monitor';
const agent={agent_id:'fixture-offline',hostname:'synthetic-only',offline_duration_minutes:300};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('both notification functions reject real loopback targets before any HTTP connection',async()=>{
 let calls=0;const server:Server=createServer((_req,res)=>{calls++;res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address()as{port:number}).port}/metadata`;
 try{for(const send of [sendOfflineAlert,sendRecoveryAlert])await expect(send(agent,url)).rejects.toThrow('Invalid Feishu webhook');expect(calls).toBe(0);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('rejects private/literal hosts, userinfo, suffix tricks, HTTP and redirect endpoints without dispatch',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 for(const target of ['http://open.feishu.cn/open-apis/bot/v2/hook/fixture','https://169.254.169.254/latest/meta-data','https://[::1]/hook','https://open.feishu.cn.evil.invalid/open-apis/bot/v2/hook/fixture','https://user@open.feishu.cn/open-apis/bot/v2/hook/fixture','https://open.feishu.cn:8443/open-apis/bot/v2/hook/fixture','https://open.feishu.cn/redirect?url=http://127.0.0.1','https://open.feishu.cn/open-apis/bot/v2/hook/fixture?redirect=evil'])await expect(sendOfflineAlert(agent,target)).rejects.toThrow('Invalid Feishu webhook');
 expect(fetchMock).not.toHaveBeenCalled();
});
it('reconstructs only the configured Feishu/Lark bot endpoint, rejects redirects and preserves failure',async()=>{
 const fetchMock=vi.fn().mockResolvedValue({ok:true,status:200});vi.stubGlobal('fetch',fetchMock);
 for(const host of ['open.feishu.cn','open.larksuite.com']){
  const url=`https://${host}/open-apis/bot/v2/hook/synthetic-fixture`;
  await sendOfflineAlert(agent,url);await sendRecoveryAlert(agent,url);
  for(const [target,options] of fetchMock.mock.calls.slice(-2)){expect(target).toBe(url);expect(options.redirect).toBe('error');expect(options.method).toBe('POST');expect(options.signal).toBeInstanceOf(AbortSignal);}
 }
 fetchMock.mockResolvedValue({ok:false,status:302});await expect(sendOfflineAlert(agent,'https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-fixture')).rejects.toThrow('webhook HTTP 302');
});
