/**
 * 企业切换器 + 顶部当前企业标识（多组织切换前端）
 *
 * 三种形态：
 *  1. needsOrgSelection=true（归属 ≥2 家但未选）→ 渲染阻断式选择界面，未选前不放进数据页
 *     （由 App.Shell 保证：needsOrgSelection 时只挂本组件，不挂 Routes）。
 *  2. 单企业（orgs.length===1）→ 只显示「当前企业：{name}」，不渲染切换下拉（A8 零回归）。
 *  3. 多企业已选 → 顶栏「当前企业」标识 + 切换下拉。
 *
 * 另：别的标签页切了企业、而本页有未提交草稿时，弹拦截提示（org-switch-draft-guard），
 * 让用户先保存/放弃，绝不静默重拉丢草稿。
 */
import { useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function OrgSwitcher() {
  const {
    orgs,
    currentOrgId,
    needsOrgSelection,
    switchOrg,
    pendingRemoteSwitch,
    confirmRemoteSwitch,
    dismissRemoteSwitch,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = useCallback(
    async (orgId: string) => {
      if (switching) return;
      setSwitching(true);
      setError('');
      try {
        await switchOrg(orgId);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : '切换企业失败，请重试');
      } finally {
        setSwitching(false);
      }
    },
    [switching, switchOrg]
  );

  // 形态 1：阻断式选择（≥2 家未选）
  if (needsOrgSelection) {
    return (
      <div className="org-selection-overlay" data-testid="org-selection-required">
        <div className="org-selection-box">
          <h2>请选择要进入的企业</h2>
          <p className="muted">你归属多家企业，请先选择一个再继续。</p>
          {error && (
            <p className="error" data-testid="org-selection-error">
              {error}
            </p>
          )}
          <ul className="org-selection-list">
            {orgs.map((o) => (
              <li key={o.org_id}>
                <button
                  type="button"
                  data-testid={`org-option-${o.org_id}`}
                  disabled={switching}
                  onClick={() => void handleSelect(o.org_id)}
                >
                  {o.name}
                  <span className="org-role">（{o.role}）</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const current = orgs.find((o) => o.org_id === currentOrgId) ?? null;

  return (
    <>
      <header className="org-switcher-bar">
        <span data-testid="current-org-label" className="org-current-label">
          当前企业：{current?.name ?? '—'}
        </span>

        {orgs.length > 1 && (
          <div className="org-switcher">
            <button
              type="button"
              data-testid="org-switcher-trigger"
              className="org-switcher-trigger"
              onClick={() => setOpen((v) => !v)}
            >
              切换企业 ▾
            </button>
            {open && (
              <ul className="org-switcher-menu" data-testid="org-switcher-menu">
                {orgs.map((o) => (
                  <li key={o.org_id}>
                    <button
                      type="button"
                      data-testid={`org-option-${o.org_id}`}
                      disabled={switching || o.org_id === currentOrgId}
                      onClick={() => void handleSelect(o.org_id)}
                    >
                      {o.name}
                      {o.org_id === currentOrgId ? '（当前）' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <span className="error" data-testid="org-switch-error">
            {error}
          </span>
        )}
      </header>

      {pendingRemoteSwitch && (
        <div className="org-draft-guard-modal" data-testid="org-switch-draft-guard">
          <div className="org-draft-guard-box">
            <p>其它标签页切换了企业，但本页还有未提交的草稿。请先保存或放弃，再切换。</p>
            <div className="org-draft-guard-actions">
              <button
                type="button"
                data-testid="org-switch-draft-discard"
                onClick={confirmRemoteSwitch}
              >
                放弃草稿并切换
              </button>
              <button
                type="button"
                data-testid="org-switch-draft-keep"
                onClick={dismissRemoteSwitch}
              >
                留在当前，先去保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
