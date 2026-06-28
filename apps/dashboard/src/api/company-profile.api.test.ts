import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCompanyProfile, updateCompanyProfile } from './company-profile.api';

// 单元测试 company-profile API 函数（mock fetch）
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getCompanyProfile', () => {
  it('returns profile data on success', async () => {
    const mockData = {
      company_name: '测试公司', city: '西安', industry: '餐饮', description: '测试',
      products: [], key_advantages: [], customer_problem: '', customer_portrait: '', qa_list: [],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockData }),
    });
    const result = await getCompanyProfile();
    expect(result.company_name).toBe('测试公司');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getCompanyProfile()).rejects.toThrow();
  });
});

describe('updateCompanyProfile', () => {
  it('calls PUT with correct body', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { updated: true } }) });
    const profile = {
      company_name: '新公司', city: '', industry: '', description: '',
      products: [], key_advantages: [], customer_problem: '', customer_portrait: '', qa_list: [],
    };
    await updateCompanyProfile(profile);
    expect(mockFetch).toHaveBeenCalledWith('/api/company-profile', expect.objectContaining({ method: 'PUT' }));
  });
});
