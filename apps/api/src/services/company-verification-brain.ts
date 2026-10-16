// 高敏归属核验只读Brain：部署固定信任配置，绝不采用用户URL、token或重定向。
import axios from 'axios';
import { companyObject, type CompanyJsonRecord } from '../routes/company-profile-validation';
export type VerificationTrust = { base: string; token: string; revision: string; collectors: string[]; validators: string[] };
export function verificationTrust(): VerificationTrust {
  const base = process.env.CECELIA_BRAIN_URL?.trim();
  const token = process.env.CECELIA_INTERNAL_TOKEN?.trim();
  const revision = process.env.COMPANY_ACCOUNT_VERIFICATION_SOURCE_REVISION?.trim();
  const actors = (key: string) => (process.env[key] ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const collectors = actors('COMPANY_ACCOUNT_VERIFICATION_COLLECTORS'), validators = actors('COMPANY_ACCOUNT_VERIFICATION_VALIDATORS');
  if (!base || !token || /[\r\n]/.test(token) || !revision || !/^[a-f0-9]{40}$/.test(revision) || !collectors.length || !validators.length) throw Error('verification trust not configured');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('invalid fixed Brain origin');
  return { base: url.origin, token, revision, collectors, validators };
}
export async function readVerificationTasks(ids: [string, string], trust: VerificationTrust): Promise<[CompanyJsonRecord, CompanyJsonRecord]> {
  const rows = await Promise.all(ids.map(async id => {
    const response = await axios.get(`${trust.base}/api/brain/tasks/${id}`, {
      headers: { Authorization: `Bearer ${trust.token}` }, timeout: 8000,
      maxRedirects: 0, proxy: false, maxContentLength: 262144, responseType: 'json',
    });
    if (response.status !== 200 || !companyObject(response.data)) throw Error('invalid Brain task response');
    const row = companyObject(response.data.task) ? response.data.task : companyObject(response.data.data) ? response.data.data : response.data;
    return row;
  }));
  return [rows[0], rows[1]];
}
