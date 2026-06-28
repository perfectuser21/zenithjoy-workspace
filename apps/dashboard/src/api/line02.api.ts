export interface Line02Account {
  label: string;
  role: 'main' | 'burner';
  health: 'ok' | 'expired' | 'unknown';
}

export interface Line02AccountStatusResponse {
  accounts: Line02Account[];
}

export async function getLine02AccountStatus(): Promise<Line02AccountStatusResponse> {
  const res = await fetch('/api/line02/account-status');
  if (!res.ok) throw new Error(`GET account-status failed: ${res.status}`);
  const json = await res.json() as { success: boolean; data: Line02AccountStatusResponse };
  if (!json.success) throw new Error('GET account-status: success=false');
  return json.data;
}
