import { afterEach, describe, expect, it, vi } from 'vitest';
import { AliVideoProvider } from '../ali-video-provider';

vi.mock('node:crypto', async (original) => ({
  ...await original<typeof import('node:crypto')>(),
  randomUUID: () => 'fixed-nonce',
}));

const env: NodeJS.ProcessEnv = {
  DASHSCOPE_API_KEY: 'test-dashscope-secret',
  DASHSCOPE_WORKSPACE_ID: 'workspace123',
  ALIYUN_ACCESS_KEY_ID: 'test-access-id',
  ALIYUN_ACCESS_KEY_SECRET: 'test-access-secret',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fixture = (...responses: Response[]) => {
  const transport = vi.fn<typeof fetch>();
  transport.mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT' && init.body && Symbol.asyncIterator in Object(init.body)) {
      for await (const chunk of init.body as unknown as AsyncIterable<Buffer>) { void chunk; /* consume the real file stream like HTTP fetch */ }
    }
    const response = responses.shift();
    if (!response) throw new Error('Unexpected HTTP request');
    return response;
  });
  return { provider: new AliVideoProvider({ env, fetch: transport }), transport };
};

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AliVideoProvider — real request contracts at the HTTP boundary', () => {
  it('uses one optional CONNECT dispatcher for Wan submit/poll and VIAPI RPC, without retrying', async () => {
    const transport=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({output:{task_id:'wan-proxy'}}))
      .mockResolvedValueOnce(json({output:{task_status:'RUNNING'}}))
      .mockResolvedValueOnce(json({Data:{Status:'PROCESSING'}}))
      .mockRejectedValueOnce(new Error('connection failed'));
    const provider=new AliVideoProvider({env:{...env,ALI_VIDEO_HTTPS_PROXY:'http://127.0.0.1:18241'},fetch:transport});
    await provider.submitWan({prompt:'hello'});
    await provider.fetchTask('wan','wan-proxy');
    await provider.fetchTask('upscale','upscale-proxy');
    const dispatcher=(transport.mock.calls[0][1] as RequestInit & {dispatcher?:unknown}).dispatcher;
    expect(dispatcher).toBeDefined();
    expect(transport.mock.calls.slice(0,3).every(([,init])=>(init as RequestInit & {dispatcher?:unknown}).dispatcher===dispatcher)).toBe(true);
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'PROVIDER_UNREACHABLE'});
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('leaves the default fetch route untouched when no proxy is configured', async () => {
    const {provider,transport}=fixture(json({output:{task_id:'wan-direct'}}));
    await provider.submitWan({prompt:'hello'});
    expect(transport.mock.calls[0][1]).not.toHaveProperty('dispatcher');
  });

  it.each(['socks5://127.0.0.1:1080','http://user:proxy-secret@localhost:18241','https://localhost:18241/private?token=proxy-secret'])('rejects invalid proxy configuration without exposing %s', async proxy=>{
    const transport=vi.fn<typeof fetch>();
    const provider=new AliVideoProvider({env:{...env,ALI_VIDEO_HTTPS_PROXY:proxy},fetch:transport});
    expect(provider.getConfiguration().wan).toEqual({configured:false,missing:['ALI_VIDEO_HTTPS_PROXY']});
    expect(provider.getConfiguration().upscale).toEqual({configured:false,missing:['ALI_VIDEO_HTTPS_PROXY']});
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'PROVIDER_NOT_CONFIGURED',message:expect.not.stringMatching(/proxy-secret|localhost/)});
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps COS direct while routing the Shanghai OSS transfer and RPC through CONNECT', async()=>{
    const {transport}=fixture(new Response('video-bytes'),new Response(''),json({RequestId:'upscale'}));
    const provider=new AliVideoProvider({env:{...env,ALI_VIDEO_HTTPS_PROXY:'http://127.0.0.1:18241',ALIYUN_VIAPI_OSS_BUCKET:'video-tools-test'},fetch:transport});
    await provider.submitUpscale({videoUrl:'https://test.cos.accelerate.myqcloud.com/video.mp4'});
    expect(transport.mock.calls[0][1]).not.toHaveProperty('dispatcher');
    expect(transport.mock.calls[1][1]).toHaveProperty('dispatcher');
    expect(transport.mock.calls[2][1]).toHaveProperty('dispatcher');
  });

  it('routes Shanghai results through the relay while keeping an other-region source on its existing path',async()=>{
    const {transport}=fixture(new Response('video-bytes'),new Response(''),json({RequestId:'upscale'}),new Response('result-bytes'));
    const provider=new AliVideoProvider({env:{...env,ALI_VIDEO_HTTPS_PROXY:'http://127.0.0.1:18241',ALIYUN_VIAPI_OSS_BUCKET:'video-tools-test'},fetch:transport});
    await provider.submitUpscale({videoUrl:'https://source.oss-cn-beijing.aliyuncs.com/video.mp4'});
    // Other regions keep their current direct path; the relay only accepts explicitly approved Shanghai buckets.
    expect(transport.mock.calls[0][1]).not.toHaveProperty('dispatcher');
    const response=await provider.downloadResult('https://vigen-invi.oss-cn-shanghai.aliyuncs.com/result.mp4?Signature=signed-result');
    expect(await response.text()).toBe('result-bytes');
    expect(transport.mock.calls[3][1]).toMatchObject({dispatcher:expect.anything(),redirect:'error',signal:expect.any(AbortSignal)});
  });

  it('does not proxy Wan accelerated result downloads through the Shanghai-only path',async()=>{
    const {transport}=fixture(new Response('wan-result'));
    const provider=new AliVideoProvider({env:{...env,ALI_VIDEO_HTTPS_PROXY:'http://127.0.0.1:18241'},fetch:transport});
    await provider.downloadResult('https://dashscope-test.oss-accelerate.aliyuncs.com/result.mp4');
    expect(transport.mock.calls[0][1]).not.toHaveProperty('dispatcher');
  });

  it('submits Wan text and media as one async job using the configured workspace', async () => {
    const { provider, transport } = fixture(json({ output: { task_id: 'wan-job' } }));
    await expect(provider.submitWan({ prompt: '猫在花园奔跑', media: [{type:'reference_image',url:'https://example.com/cat.png'}], resolution:'720P',duration:5,ratio:'9:16',audio:false })).resolves.toEqual({taskId:'wan-job'});
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('https://workspace123.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({Authorization:'Bearer test-dashscope-secret','X-DashScope-Async':'enable'});
    expect(JSON.parse(String(init?.body))).toEqual({model:'wan3.0-video',input:{prompt:'猫在花园奔跑',media:[{type:'reference_image',url:'https://example.com/cat.png'}]},parameters:{resolution:'720P',duration:5,ratio:'9:16',audio:false,prompt_extend:true}});
  });

  it('uses the explicit DashScope base URL without a workspace id', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({output:{task_id:'job'}}));
    const provider = new AliVideoProvider({env:{...env,DASHSCOPE_WORKSPACE_ID:undefined,DASHSCOPE_BASE_URL:'https://dashscope.aliyuncs.com/api/v1'},fetch:transport});
    await provider.submitWan({prompt:'hello'});
    expect(String(transport.mock.calls[0][0])).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis');
  });

  it.each(['http://dashscope.aliyuncs.com','https://attacker.example','https://dashscope.aliyuncs.com.attacker.example','https://user:password@dashscope.aliyuncs.com'])('rejects unsafe endpoint %s before sending any secret', async base => {
    const transport = vi.fn<typeof fetch>();
    const provider = new AliVideoProvider({env:{...env,DASHSCOPE_BASE_URL:base},fetch:transport});
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'PROVIDER_NOT_CONFIGURED',status:503});
    expect(transport).not.toHaveBeenCalled();
  });

  it('reports missing configuration and never submits with an empty key', async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = new AliVideoProvider({env:{},fetch:transport});
    expect(provider.getConfiguration()).toEqual({wan:{configured:false,missing:['DASHSCOPE_API_KEY']},upscale:{configured:false,missing:['ALIYUN_ACCESS_KEY_ID','ALIYUN_ACCESS_KEY_SECRET']}});
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({status:503});
    expect(transport).not.toHaveBeenCalled();
  });

  it('signs a VIAPI super-resolution request according to Alibaba RPC v1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
    const {provider,transport} = fixture(json({RequestId:'upscale-job'}));
    await expect(provider.submitUpscale({videoUrl:'https://viapi-test.oss-cn-shanghai.aliyuncs.com/source.mp4',bitRate:5})).resolves.toEqual({taskId:'upscale-job'});
    const [url,init] = transport.mock.calls[0];
    expect(url).toBe('https://videoenhan.cn-shanghai.aliyuncs.com/');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('Action')).toBe('SuperResolveVideo');
    expect(body.get('VideoUrl')).toBe('https://viapi-test.oss-cn-shanghai.aliyuncs.com/source.mp4');
    expect(body.get('BitRate')).toBe('5');
    expect(body.get('Signature')).toBe('JvERoFTiY5MKcMG7tUYYsMvZg7E=');
    expect(body.has('AccessKeySecret')).toBe(false);
  });

  it('uses the verified standard Wan endpoint when only the API key is configured', async () => {
    const transport=vi.fn<typeof fetch>().mockResolvedValue(json({output:{task_id:'wan-standard'}}));
    const provider=new AliVideoProvider({env:{DASHSCOPE_API_KEY:'test-key'},fetch:transport});
    expect(provider.getConfiguration().wan.configured).toBe(true);
    await provider.submitWan({prompt:'hello'});
    expect(transport.mock.calls[0][0]).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis');
  });

  it('transfers COS input through temporary Shanghai OSS credentials before paid super-resolution submission', async () => {
    const {provider,transport}=fixture(
      new Response('video-bytes', {headers:{'content-length':'11'}}),
      json({Data:{AccessKeyId:'STS.test-id',AccessKeySecret:'temp-secret',SecurityToken:'temp-token'}}),
      new Response(null,{status:200}),
      json({RequestId:'upscale-transferred'}),
    );
    await expect(provider.submitUpscale({videoUrl:'https://company.cos.ap-guangzhou.myqcloud.com/source.mp4',bitRate:5})).resolves.toEqual({taskId:'upscale-transferred'});
    expect(transport.mock.calls[1][0]).toBe('https://viapiutils.cn-shanghai.aliyuncs.com/');
    expect(new URLSearchParams(String(transport.mock.calls[1][1]?.body)).get('Action')).toBe('GetOssStsToken');
    expect(transport.mock.calls[2][0]).toBe('https://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/test-access-id/fixed-nonce/source.mp4');
    expect(transport.mock.calls[2][1]?.headers).toMatchObject({'x-oss-security-token':'temp-token',Authorization:expect.stringMatching(/^OSS STS\.test-id:/)});
    const submission=new URLSearchParams(String(transport.mock.calls[3][1]?.body));
    expect(submission.get('VideoUrl')).toBe('https://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/test-access-id/fixed-nonce/source.mp4');
  });

  it('does not fetch arbitrary URLs from the API server during super-resolution transfer', async () => {
    const {provider,transport}=fixture();
    await expect(provider.submitUpscale({videoUrl:'https://attacker.example/source.mp4'})).rejects.toMatchObject({status:400});
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([['PENDING','pending'],['RUNNING','running'],['FAILED','failed'],['CANCELED','canceled'],['UNKNOWN','unknown']])('maps Wan status %s into %s', async (upstream,expected) => {
    const {provider} = fixture(json({output:{task_status:upstream,code:'ModelFailed',message:'failure'}}));
    expect((await provider.fetchTask('wan','job-id')).status).toBe(expected);
  });

  it('returns the generated video only when Wan reports actual success', async () => {
    const {provider,transport} = fixture(json({output:{task_status:'SUCCEEDED',video_url:'https://example.com/result.mp4'}}));
    await expect(provider.fetchTask('wan','wan-job')).resolves.toEqual({status:'succeeded',videoUrl:'https://example.com/result.mp4'});
    expect(transport.mock.calls[0][0]).toBe('https://workspace123.cn-beijing.maas.aliyuncs.com/api/v1/tasks/wan-job');
  });

  it('does not turn success without an actual output video into a usable result', async () => {
    const {provider} = fixture(json({output:{task_status:'SUCCEEDED'}}));
    await expect(provider.fetchTask('wan','wan-job')).rejects.toMatchObject({code:'INVALID_PROVIDER_RESPONSE',status:502});
  });

  it('rejects a successful HTTP response that did not create a task', async () => {
    const {provider} = fixture(json({output:{}}));
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'INVALID_PROVIDER_RESPONSE'});
  });

  it.each(['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com/output.mp4'])('does not expose an unsafe provider result URL %s', async url => {
    const {provider} = fixture(json({output:{task_status:'SUCCEEDED',video_url:url}}));
    await expect(provider.fetchTask('wan','job')).rejects.toMatchObject({code:'INVALID_PROVIDER_RESPONSE'});
  });

  it.each([['QUEUING','pending'],['PROCESSING','running'],['PROCESS_FAILED','failed'],['TIMEOUT_FAILED','failed'],['LIMIT_RETRY_FAILED','failed']])('maps VIAPI status %s into %s', async (upstream,expected) => {
    const {provider} = fixture(json({Data:{Status:upstream,ErrorCode:'Failed'}}));
    expect((await provider.fetchTask('upscale','job-id')).status).toBe(expected);
  });

  it('reads a VIAPI result JSON and uses JobId when polling', async () => {
    const {provider,transport} = fixture(json({Data:{Status:'PROCESS_SUCCESS',Result:JSON.stringify({VideoUrl:'https://example.com/hd.mp4'})}}));
    await expect(provider.fetchTask('upscale','upscale-id')).resolves.toEqual({status:'succeeded',videoUrl:'https://example.com/hd.mp4'});
    const body = new URLSearchParams(String(transport.mock.calls[0][1]?.body));
    expect(body.get('Action')).toBe('GetAsyncJobResult');
    expect(body.get('JobId')).toBe('upscale-id');
  });

  it.each(['not-json',JSON.stringify({})])('refuses unusable VIAPI success result %s', async result => {
    const {provider} = fixture(json({Data:{Status:'PROCESS_SUCCESS',Result:result}}));
    await expect(provider.fetchTask('upscale','job')).rejects.toMatchObject({code:'INVALID_PROVIDER_RESPONSE'});
  });

  it('does not leak upstream messages, bearer tokens or signed URLs in an error', async () => {
    const {provider} = fixture(json({code:'InvalidApiKey',message:'test-dashscope-secret https://example.com/?Signature=leak'},401));
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'UPSTREAM_ERROR',status:502,message:expect.not.stringMatching(/secret|Signature|example\.com/)});
  });

  it('converts transport exceptions to a safe actionable error', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('network test-dashscope-secret'));
    const provider = new AliVideoProvider({env,fetch:transport});
    await expect(provider.submitWan({prompt:'hello'})).rejects.toMatchObject({code:'PROVIDER_UNREACHABLE',status:502,message:expect.not.stringMatching(/secret/)});
  });
});
