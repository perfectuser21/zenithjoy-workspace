import { Activity, ClipboardCheck, LayoutDashboard, LogOut, Wrench } from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import FeishuLogin from './pages/FeishuLogin';
import HomePage from './pages/HomePage';
import SkillEvalPage from './pages/SkillEvalPage';
import LineHealthPage from './pages/LineHealthPage';
import LineHealthDetailPage from './pages/LineHealthDetailPage';
import AcceptancePage from './pages/AcceptancePage';
import AcceptanceDetailPage from './pages/AcceptanceDetailPage';
import EnvBadge from './components/EnvBadge';

function Shell() {
  const { authLoading, isAuthenticated, logout, user } = useAuth();

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
          <Route path="/acceptance/:runKey" element={<AcceptanceDetailPage />} />
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
