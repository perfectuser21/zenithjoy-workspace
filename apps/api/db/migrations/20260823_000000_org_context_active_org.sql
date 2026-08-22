-- 多组织切换 · 组织与权限底座 第一刀
--
-- 引入服务端会话态 active_org 维度（J7：载体=better-auth session 附加字段，绝不引入 X-Org-Id 请求头）。
-- 一个员工归属 ≥2 家企业时，「当前企业」这一跳只落在服务端会话行里，客户端无从伪造。
--
-- 另建 org_audit：org 解析越权 deny / 切换 各落一条审计行（A11，中间件自动副作用），
-- 跨企业越权是安全事件，必须留下不可抵赖的取证链，且不依赖各端点自记。

-- better-auth 的 session 表在 public schema（见 20260428 better_auth_schema，无 schema 前缀＝public）。
-- 列名用 camelCase "activeOrg"，与既有 "expiresAt"/"userId" 同口径，让 better-auth session.additionalFields
-- 能原样读写这一列。可空：单企业账号与「≥2 家未选」都是 NULL（前者透明解析、后者要求先选）。
ALTER TABLE public.session ADD COLUMN IF NOT EXISTS "activeOrg" text;

-- org 审计表。member_id=会话身份(open_id/user.id)，event=resolve_deny|switch，
-- org_id=本次涉及的企业（deny 时可为被伪造/越权的目标），detail=文字线索（不含姓名/邮箱）。
CREATE TABLE IF NOT EXISTS zenithjoy.org_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   text        NOT NULL,
  event       text        NOT NULL CHECK (event IN ('switch', 'resolve_deny')),
  org_id      text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_audit_member_idx ON zenithjoy.org_audit (member_id, created_at DESC);
