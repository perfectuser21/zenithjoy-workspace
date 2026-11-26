import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPipelines, runPipeline, fetchWorkerCapability } from '../pipeline.api'
import { createTopic, getPacingConfig, publishTopicNow, type Topic } from '../topics.api'

afterEach(() => vi.unstubAllGlobals())
const response = (body: unknown, ok = true) => ({ok, json:async()=>body})
const topic = {id:'t1', title:'案例主题'} as Topic

describe('local content handoff API', () => {
  it('keeps historical post data visible and maps pending to queued', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([{id:'old',topic:'旧图文',content_type:'post',status:'pending',created_at:'2026-11-14'}])))
    const [run] = await fetchPipelines()
    expect(run).toMatchObject({id:'old',title:'旧图文',status:'queued',payload:{content_type:'post'}})
  })
  it('uses the same-origin employee session for topics and pacing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ success: true, data: topic }))
      .mockResolvedValueOnce(response({ success: true, data: { daily_limit: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await createTopic({ title: topic.title })).toEqual(topic)
    expect(await getPacingConfig()).toEqual({ daily_limit: 1 })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/content-factory/topics',
      expect.objectContaining({ credentials: 'same-origin', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/content-factory/topics/pacing/config',
      expect.objectContaining({ credentials: 'same-origin' }))
  })
  it('takes a valid pending registration envelope without declaring it running', async () => {
    const fetchMock=vi.fn().mockResolvedValue(response({success:true,data:{id:'p1',status:'pending',cecelia_task_id:'task1'}}))
    vi.stubGlobal('fetch',fetchMock)
    expect(await publishTopicNow(topic)).toMatchObject({status:'pending',cecelia_task_id:'task1'})
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({content_type:'solo-company-case',topic_id:'t1'})
  })
  it('reads back the existing running task after a retried topic intent without reporting it queued', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({success:true,data:{id:'p1',status:'running',cecelia_task_id:'task1'}})))
    expect(await publishTopicNow(topic)).toMatchObject({id:'p1',status:'running',cecelia_task_id:'task1'})
  })
  it('does not accept a 201 response missing the Brain registration receipt', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({success:true,data:{id:'p1',status:'pending'}})))
    await expect(publishTopicNow(topic)).rejects.toThrow('未取得 Brain 任务登记回执')
  })
  it('propagates a failed Brain registration envelope', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({success:false,error:{message:'Brain 任务登记失败'}},false)))
    await expect(publishTopicNow(topic)).rejects.toThrow('Brain 任务登记失败')
  })
  it('shows rerun conflicts instead of pretending the task was queued again', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({success:false,error:{message:'已有运行中的任务'}},false)))
    await expect(runPipeline('p1')).rejects.toThrow('已有运行中的任务')
  })
  it('does not invent a default capability when the local endpoint is incomplete', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({content_type:'solo-company-case',stages:[]})))
    await expect(fetchWorkerCapability()).rejects.toThrow('内容执行器信息不完整')
  })
})
