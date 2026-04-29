/**
 * AdminUsersPage — PR-A 超管会员管理 /admin/users
 *
 * 功能：
 *  - 列出所有 better-auth 注册用户 + 各自所属 tenants（聚合）
 *  - 顶部 email 模糊搜索 + 分页
 *  - 行操作：拉用户进 tenant / 移除某 tenant 成员 / 删除用户
 *
 * 仅 super-admin 可见（由 navigation.config requireSuperAdmin + 页内兜底渲染）。
 */
import { useState, useMemo, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import {
  listUsers,
  addUserToTenant,
  removeUserFromTenant,
  deleteUser,
  type UserRow,
  type TenantRole,
} from '../api/admin-users.api';

const PAGE_SIZE = 50;

const ROLE_OPTIONS: { value: TenantRole; label: string }[] = [
  { value: 'member', label: 'member' },
  { value: 'admin', label: 'admin' },
  { value: 'owner', label: 'owner' },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

interface AddDialogState {
  open: boolean;
  user: UserRow | null;
}

export default function AdminUsersPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [page, setPage] = useState(0);
  const [addDialog, setAddDialog] = useState<AddDialogState>({
    open: false,
    user: null,
  });
  const [tenantInput, setTenantInput] = useState('');
  const [roleInput, setRoleInput] = useState<TenantRole>('member');
  const [dialogMsg, setDialogMsg] = useState<string | null>(null);

  const offset = useMemo(() => page * PAGE_SIZE, [page]);

  const listQuery = useQuery({
    queryKey: ['admin-users', submittedQ, page],
    queryFn: () =>
      listUsers({ q: submittedQ || undefined, limit: PAGE_SIZE, offset }),
    enabled: isSuperAdmin,
  });

  const addMut = useMutation({
    mutationFn: (args: {
      userId: string;
      tenant_id: string;
      role: TenantRole;
    }) => addUserToTenant(args.userId, { tenant_id: args.tenant_id, role: args.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setAddDialog({ open: false, user: null });
      setTenantInput('');
      setRoleInput('member');
      setDialogMsg(null);
    },
    onError: (err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      setDialogMsg(`加入失败：${m}`);
    },
  });

  const removeMut = useMutation({
    mutationFn: (args: { userId: string; tenantId: string }) =>
      removeUserFromTenant(args.userId, args.tenantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (userId: string) => deleteUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 24, color: '#dc2626' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>403 — 权限不足</h1>
        <p>本页面仅 super-admin 可访问。</p>
      </div>
    );
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setSubmittedQ(q.trim());
  }

  function openAddDialog(user: UserRow) {
    setAddDialog({ open: true, user });
    setTenantInput('');
    setRoleInput('member');
    setDialogMsg(null);
  }

  function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    if (!addDialog.user) return;
    if (!tenantInput.trim()) {
      setDialogMsg('请填 Tenant ID');
      return;
    }
    addMut.mutate({
      userId: addDialog.user.id,
      tenant_id: tenantInput.trim(),
      role: roleInput,
    });
  }

  function handleRemoveTenant(userId: string, tenantId: string, tName: string) {
    if (window.confirm(`确认把该用户从 "${tName}" 移除？`)) {
      removeMut.mutate({ userId, tenantId });
    }
  }

  function handleDeleteUser(user: UserRow) {
    if (
      window.confirm(
        `确认删除用户 ${user.email}？\n该操作会级联清理 session/account/tenant_members，不可逆。`
      )
    ) {
      deleteMut.mutate(user.id);
    }
  }

  const data = listQuery.data;
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        会员管理（super-admin）
      </h1>

      {/* 搜索框 */}
      <form
        onSubmit={handleSearch}
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 email"
          style={{
            flex: '0 0 320px',
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 6,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 16px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          搜索
        </button>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>
          总计 {total} 个用户
        </span>
      </form>

      {/* 列表 */}
      {listQuery.isLoading ? (
        <div>加载中…</div>
      ) : users.length === 0 ? (
        <div style={{ padding: 16, color: '#6b7280' }}>暂无用户</div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
          }}
        >
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>注册时间</Th>
              <Th>邮箱已验证</Th>
              <Th>Tenants</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>{u.email}</Td>
                <Td>{u.name}</Td>
                <Td>{formatDate(u.createdAt)}</Td>
                <Td>{u.emailVerified ? '是' : '否'}</Td>
                <Td>
                  {u.tenants.length === 0 ? (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {u.tenants.map((t) => (
                        <span
                          key={t.tenant_id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: '#eef2ff',
                            color: '#3730a3',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 12,
                          }}
                        >
                          {t.name} ({t.role})
                          <button
                            type="button"
                            aria-label="移除 tenant member"
                            onClick={() =>
                              handleRemoveTenant(u.id, t.tenant_id, t.name)
                            }
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              color: '#6366f1',
                              fontSize: 12,
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => openAddDialog(u)}
                      style={{
                        padding: '4px 10px',
                        background: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      拉进 tenant
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(u)}
                      disabled={deleteMut.isPending}
                      style={{
                        padding: '4px 10px',
                        background: '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      删除用户
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={pageBtnStyle}
          >
            上一页
          </button>
          <span style={{ fontSize: 13, color: '#374151' }}>
            第 {page + 1} / {totalPages} 页
          </span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={pageBtnStyle}
          >
            下一页
          </button>
        </div>
      )}

      {/* 拉进 tenant 弹窗 */}
      {addDialog.open && addDialog.user && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setAddDialog({ open: false, user: null })}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddSubmit}
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              width: 460,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              display: 'grid',
              gap: 12,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>
              将 {addDialog.user.email} 加入 tenant
            </h2>
            <label>
              <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
                Tenant ID（UUID）
              </span>
              <input
                type="text"
                value={tenantInput}
                onChange={(e) => setTenantInput(e.target.value)}
                placeholder="11111111-1111-1111-1111-111111111111"
                style={inputStyle}
              />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12, color: '#6b7280' }}>
                角色 / Role
              </span>
              <select
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as TenantRole)}
                style={inputStyle}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {dialogMsg && (
              <div style={{ color: '#dc2626', fontSize: 13 }}>{dialogMsg}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setAddDialog({ open: false, user: null })}
                style={{
                  padding: '6px 14px',
                  background: '#e5e7eb',
                  color: '#111827',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={addMut.isPending}
                style={{
                  padding: '6px 14px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: addMut.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {addMut.isPending ? '提交中…' : '确认'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  marginTop: 4,
};

const pageBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 13,
        color: '#374151',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 12px', fontSize: 14 }}>{children}</td>;
}
