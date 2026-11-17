import type { PoolClient } from 'pg';

// 登记请求不能随换机/删除现役账号而失忆；只在登记器的全局事务锁内查询。
export async function accountRequestWasUsed(client: PoolClient, requestId: string): Promise<boolean> {
  const result = await client.query(`SELECT company_id, conflict FROM zenithjoy.company_config_changes
    WHERE source IN ('account_registration', 'account_device_replacement') AND (
      (conflict->>'request_id'=$1 AND conflict->>'operation' IS NOT NULL)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(new_snapshot#>'{runtime_config,platform_accounts}')='array'
        THEN new_snapshot#>'{runtime_config,platform_accounts}' ELSE '[]'::jsonb END) account
        WHERE account#>>'{source,registration_request_id}'=$1)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(old_snapshot#>'{runtime_config,platform_accounts}')='array'
        THEN old_snapshot#>'{runtime_config,platform_accounts}' ELSE '[]'::jsonb END) account
        WHERE account#>>'{source,registration_request_id}'=$1)
    ) LIMIT 1`, [requestId]);
  return result.rows.length > 0;
}
