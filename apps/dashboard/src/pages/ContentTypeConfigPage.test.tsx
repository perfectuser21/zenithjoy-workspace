import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ContentTypeConfigPage from './ContentTypeConfigPage'

afterEach(() => { vi.unstubAllGlobals() })
describe('content worker capability page', () => {
  it('reads only the local real worker capability and links to topic Notebook settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ok: true, json: async () => ({content_type:'solo-company-case', label:'案例内容', stages:['research','copywriting','copy_review','generate','image_review','export'], notebook_source:'topic'})})
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><ContentTypeConfigPage /></MemoryRouter>)
    expect(await screen.findByText('solo-company-case')).toBeInTheDocument()
    expect(screen.getByRole('link', {name:'前往选题池设置 Notebook'})).toHaveAttribute('href','/content-factory')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/pipeline/capabilities'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('初始化配置')).not.toBeInTheDocument()
    expect(screen.queryByText('测试步骤')).not.toBeInTheDocument()
  })
  it('shows local capability failures without pretending a default worker is ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:false, status:503, json:async()=>({error:'内容执行器不可用'})}))
    render(<MemoryRouter><ContentTypeConfigPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('内容执行器不可用')
    expect(screen.queryByText('solo-company-case')).not.toBeInTheDocument()
  })
})
