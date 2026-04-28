import pool from '../db/connection';

export interface Tenant {
  id: string;
  name: string;
  licenseKey: string;
  plan: string;
}

export async function findTenantByLicense(licenseKey: string): Promise<Tenant | null> {
  const { rows } = await pool.query<{
    id: string; name: string; license_key: string; plan: string;
  }>(
    'SELECT id, name, license_key, plan FROM zenithjoy.tenants WHERE license_key = $1',
    [licenseKey]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, licenseKey: r.license_key, plan: r.plan };
}
