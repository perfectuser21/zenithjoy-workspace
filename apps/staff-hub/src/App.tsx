import { Activity, BookOpen, ClipboardCheck, History, LayoutDashboard, LogOut, PenLine, Wrench } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import FeishuLogin from './pages/FeishuLogin';
import HomePage from './pages/HomePage';
import SkillEvalPage from './pages/SkillEvalPage';
import LineHealthPage from './pages/LineHealthPage';
import LineHealthDetailPage from './pages/LineHealthDetailPage';
import AcceptancePage from './pages/AcceptancePage';
import AcceptanceDetailPage from './pages/AcceptanceDetailPage';
import AcceptanceHistoryPage from './pages/AcceptanceHistoryPage';
import QuadrantPage from './pages/QuadrantPage';
import NewRunPage from './pages/NewRunPage';
import KnowledgeNewPage from './pages/KnowledgeNewPage';
import KnowledgeRecentPage from './pages/KnowledgeRecentPage';
import WorkbenchPage from './pages/WorkbenchPage';
import EnvBadge from './components/EnvBadge';
import { adminFetch } from './lib/adminFetch';

function Shell() {
  const { authLoading, isAuthenticated, logout, user } = useAuth();
  const [acceptanceBadge, setAcceptanceBadge] = useState<number>(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchBadge = async () => {
      try {
        const res = await adminFetch('/api/staff/acceptance/pending', user);
        const json = await res.json() as { runs?: { status?: string }[]; availability?: string };
        if (cancelled || json.availability === 'degraded') return;
        const pending = (json.runs ?? []).filter(
          (r) => r.status !== 'closed'
        ).length;
        setAcceptanceBadge(pending);
      } catch {
        // 静默失败，不影响页面
      }
    };
    void fetchBadge();
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading) {
    return <div className="login-wrap"><div className="card">加载中...</div></div>;
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login/feishu" element={<FeishuLogin />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-title">Staff Hub</div>
        <p className="brand-subtitle">员工专属前台，和客户 Dashboard 完全分开。</p>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <LayoutDashboard size={18} /> 首页
          </NavLink>
          <NavLink to="/skill-eval" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Wrench size={18} /> Skill 验收
          </NavLink>
          <NavLink to="/line-health" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Activity size={18} /> 业务线健康
          </NavLink>
          <NavLink to="/acceptance" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <ClipboardCheck size={18} /> 验收
            <span
              data-testid="acceptance-nav-badge"
              style={{
                marginLeft: '6px',
                background: acceptanceBadge > 0 ? '#d64545' : '#eceff2',
                color: acceptanceBadge > 0 ? '#fff' : '#7a8494',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-block',
                minWidth: '18px',
                textAlign: 'center',
              }}
            >
              {acceptanceBadge}
            </span>
          </NavLink>
          <NavLink to="/acceptance-history" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <History size={18} /> 验收历史
          </NavLink>
          <NavLink to="/knowledge/new" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <PenLine size={18} /> 沉淀经验
          </NavLink>
          <NavLink to="/knowledge/recent" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <BookOpen size={18} /> 最近沉淀
          </NavLink>
          <NavLink to="/workbench" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Wrench size={16} /> 结构化工作台
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="muted">{user?.email || user?.name}</div>
          <button className="button secondary" onClick={logout}>
            <LogOut size={16} /> 退出
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/skill-eval" element={<SkillEvalPage />} />
          <Route path="/line-health" element={<LineHealthPage />} />
          <Route path="/line-health/:lineKey" element={<LineHealthDetailPage />} />
          <Route path="/acceptance" element={<AcceptancePage />} />
          <Route path="/acceptance/new" element={<NewRunPage />} />
          <Route path="/acceptance/:runKey/quadrant" element={<QuadrantPage />} />
          <Route path="/acceptance/:runKey" element={<AcceptanceDetailPage />} />
          <Route path="/acceptance-history" element={<AcceptanceHistoryPage />} />
          <Route path="/knowledge/new" element={<KnowledgeNewPage />} />
          <Route path="/knowledge/recent" element={<KnowledgeRecentPage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="/login/feishu" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <EnvBadge />
      <Shell />
    </AuthProvider>
  );
}
