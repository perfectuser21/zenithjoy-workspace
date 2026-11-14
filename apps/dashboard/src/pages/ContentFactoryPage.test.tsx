import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ContentFactoryPage from './ContentFactoryPage'
vi.mock('./content-factory/TopicPoolTab',()=>({default:()=> <div>选题池面板</div>}))
afterEach(()=>vi.unstubAllGlobals())
const run={id:'p1',topic:'既存图文任务',content_type:'post',status:'pending',cecelia_task_id:'brain-task1',created_at:'2026-11-14T00:00:00Z'}
function setFetch(status='pending') {
  const mock=vi.fn(async(path:string)=>path==='/api/pipeline'?{ok:true,json:async()=>[{...run,status}]}:{ok:false,json:async()=>({success:false,error:{message:'内容服务不可用'}})})
  vi.stubGlobal('fetch',mock)
  return mock
}
describe('content factory queued handoff',()=>{
  it('shows legacy post and pending as waiting for claim without a second start action',async()=>{
    setFetch()
    render(<MemoryRouter><ContentFactoryPage /></MemoryRouter>)
    await screen.findByText('选题池面板')
    fireEvent.click(screen.getByRole('button',{name:'生产看板'}))
    expect(await screen.findByText('既存图文任务')).toBeInTheDocument()
    expect(screen.getByText('post',{exact:true})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'开始执行'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'重新排队'})).not.toBeInTheDocument()
  })
  it('shows rerun conflicts and keeps the failed task visible',async()=>{
    const mock=setFetch('failed')
    render(<MemoryRouter><ContentFactoryPage /></MemoryRouter>)
    await screen.findByText('选题池面板')
    fireEvent.click(screen.getByRole('button',{name:'生产看板'}))
    fireEvent.click(await screen.findByRole('button',{name:'重新排队'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容服务不可用')
    expect(mock).toHaveBeenCalledWith('/api/pipeline/p1/rerun',{method:'POST'})
  })
  it('retries an uncertain registration on the same run instead of creating another pipeline',async()=>{
    const mock=vi.fn(async(path:string)=> path==='/api/pipeline' ? {ok:true,json:async()=>[{...run,cecelia_task_id:null}]} : {ok:true,json:async()=>({success:true,data:{id:'p1',status:'pending',cecelia_task_id:'new-task'}})})
    vi.stubGlobal('fetch',mock)
    render(<MemoryRouter><ContentFactoryPage /></MemoryRouter>)
    await screen.findByText('选题池面板')
    fireEvent.click(screen.getByRole('button',{name:'生产看板'}))
    fireEvent.click(await screen.findByRole('button',{name:'重试挂号'}))
    await vi.waitFor(()=>expect(mock).toHaveBeenCalledWith('/api/pipeline/p1/register',{method:'POST'}))
    expect(mock.mock.calls.some(([path])=>String(path).includes('/trigger')||String(path).includes('/rerun'))).toBe(false)
  })
  it('reports failed stage loading without leaving the page in a false loading state',async()=>{
    setFetch()
    render(<MemoryRouter><ContentFactoryPage /></MemoryRouter>)
    await screen.findByText('选题池面板')
    fireEvent.click(screen.getByRole('button',{name:'生产看板'}))
    fireEvent.click(await screen.findByRole('button',{name:'步骤'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容服务不可用')
    expect(screen.queryByText('加载阶段详情...')).not.toBeInTheDocument()
  })
})
