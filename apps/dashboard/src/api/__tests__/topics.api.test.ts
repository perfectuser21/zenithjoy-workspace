import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTopic, getPacingConfig } from '../topics.api'

afterEach(() => vi.unstubAllGlobals())
const response = (body: unknown) => ({ ok: true, json: async () => body })
const topic = { id: 'draft-1', title: 'staging fixture', status: '已拒绝' }

describe('employee Topics API', () => {
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
})
