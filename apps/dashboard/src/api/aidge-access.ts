export async function getAidgeAccess(): Promise<'viewer' | 'staff' | null> {
  const response = await fetch('/api/aidge/access', { credentials: 'include', cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('无法验证 Aidge 访问权限');
  const data = await response.json() as { role?: string };
  if (data.role !== 'viewer' && data.role !== 'staff') throw new Error('Aidge 访问权限响应无效');
  return data.role;
}
