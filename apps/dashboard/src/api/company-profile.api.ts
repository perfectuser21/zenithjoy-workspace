export interface CompanyProfile {
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
  if (!res.ok) throw new Error(`GET company-profile failed: ${res.status}`);
  const json = await res.json() as { success: boolean; data: CompanyProfile };
  if (!json.success) throw new Error('GET company-profile: success=false');
  return json.data;
}

export async function updateCompanyProfile(profile: CompanyProfile): Promise<void> {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: { message: string } };
    throw new Error(json.error?.message || `PUT company-profile failed: ${res.status}`);
  }
}
