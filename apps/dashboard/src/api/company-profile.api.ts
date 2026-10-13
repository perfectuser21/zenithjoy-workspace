export interface CompanyProfile {
  company_id?: string;
  company_key?: string;
  config_version?: number;
  config_status?: 'draft' | 'confirmed' | 'enabled';
  config_owner?: string;
  wiki?: { markdown?: string; [key: string]: unknown };
  runtime_config?: Record<string, unknown>;
  source_evidence?: unknown[] | Record<string, unknown>;
  sync_status?: Record<string, { status: string }>;
  company_name: string;
  city: string;
  industry: string;
  description: string;
  products: string[];
  key_advantages: string[];
  customer_problem: string;
  customer_portrait: string;
  qa_list: Array<{ q: string; a: string }>;
}

const BASE = '/api/company-profile';

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const res = await fetch(BASE);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error?.message || `公司资料读取失败：${res.status}`);
  }
  const json = await res.json() as { success: boolean; data: CompanyProfile };
  if (!json.success) throw new Error('GET company-profile: success=false');
  return json.data;
}

export async function updateCompanyProfile(profile: CompanyProfile): Promise<{ config_version: number; profile: CompanyProfile }> {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: profile.company_name, city: profile.city, industry: profile.industry,
      description: profile.description, products: profile.products, key_advantages: profile.key_advantages,
      customer_problem: profile.customer_problem, customer_portrait: profile.customer_portrait,
      qa_list: profile.qa_list, wiki: profile.wiki, runtime_config: profile.runtime_config,
      config_status: profile.config_status, config_owner: profile.config_owner,
      source_evidence: profile.source_evidence, expected_version: profile.config_version,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(json.error?.message || `PUT company-profile failed: ${res.status}`);
  }
  const json = await res.json();
  if (!json.success || !json.data?.updated) throw new Error('公司配置未保存');
  return json.data;
}
