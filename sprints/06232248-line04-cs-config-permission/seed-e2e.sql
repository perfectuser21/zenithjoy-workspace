-- Line04 客服配置写接口安全闸 — 后端 E2E 种子数据
-- 造两家公司（tenant-A / tenant-B）+ A 的 admin/member 成员 + 各自一个客服（service_agents.wechat_id）。
-- 越权/隔离断言据此跑：member 改 A 客服 → 403；A admin 改 B 客服 → 403/404；解析不出目标 → 404。
-- 幂等：固定 UUID + ON CONFLICT DO NOTHING / UPDATE，可重复跑。

-- ── 两家租户 ──
INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
VALUES
  ('aaaaaaaa-1111-2222-3333-444444444444', 'E2E 公司A', 'e2e-lic-key-A', 'pro'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'E2E 公司B', 'e2e-lic-key-B', 'pro')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ── 成员：A 的 admin + member（tenantContext 按 feishu_user_id 反查角色）──
INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
VALUES
  ('aaaaaaaa-1111-2222-3333-444444444444', 'user-admin-A', 'admin'),
  ('aaaaaaaa-1111-2222-3333-444444444444', 'user-member-A', 'member'),
  ('bbbbbbbb-1111-2222-3333-444444444444', 'user-admin-B', 'admin')
ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role = EXCLUDED.role;

-- ── license（service_agents 不强依赖，但保持租户数据完整）──
INSERT INTO zenithjoy.licenses (id, license_key, tier, max_machines, customer_id, status, expires_at)
VALUES
  ('cccccccc-1111-2222-3333-444444444444', 'e2e-lic-A', 'basic', 5, 'user-admin-A', 'active', now() + interval '365 days'),
  ('dddddddd-1111-2222-3333-444444444444', 'e2e-lic-B', 'basic', 5, 'user-admin-B', 'active', now() + interval '365 days')
ON CONFLICT (id) DO NOTHING;

-- ── 客服-PC 绑定：A 家客服 wxid_csa / B 家客服 wxid_csb（guard 按 wechat_id 解析目标租户）──
INSERT INTO zenithjoy.service_agents (id, tenant_id, machine_id, wechat_id)
VALUES
  ('11111111-aaaa-2222-3333-444444444444', 'aaaaaaaa-1111-2222-3333-444444444444', 'machine-csa', 'wxid_csa'),
  ('22222222-bbbb-2222-3333-444444444444', 'bbbbbbbb-1111-2222-3333-444444444444', 'machine-csb', 'wxid_csb')
ON CONFLICT (id) DO UPDATE SET wechat_id = EXCLUDED.wechat_id, tenant_id = EXCLUDED.tenant_id;

-- 清掉上一轮可能写入的目标行，保证「DB 未变 / 时间窗」断言从干净态起跑
DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('wxid_csa', 'wxid_csb', 'wxid_never_zzz');
