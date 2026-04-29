/**
 * SignIn — 邮箱+密码登录页面（PR-3）
 *
 * 提交 → POST /api/auth/sign-in/email
 * 成功 → login() + 跳 /
 *
 * 提供三个出口：
 *  - 注册（/signup）
 *  - 忘记密码（/forgot-password）
 *  - 内部员工飞书登录（/login/feishu）— 双轨保留
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { signInEmail } from '../api/better-auth.api';

export default function SignIn() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('请填写邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      const result = await signInEmail({
        email: email.trim(),
        password,
      });
      login(
        {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
        },
        result.token || 'better-auth-session'
      );
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo-white.png" alt="ZenithJoy" className="h-12 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">欢迎回来</h1>
          <p className="text-white/50 text-sm mt-2">
            登录你的账号，继续工作
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl space-y-4"
        >
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* 邮箱 */}
          <div>
            <label
              htmlFor="si-email"
              className="block text-white/70 text-sm mb-2"
            >
              邮箱
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="si-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50"
              />
            </div>
          </div>

          {/* 密码 */}
          <div>
            <label
              htmlFor="si-password"
              className="block text-white/70 text-sm mb-2"
            >
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="si-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-sm text-sky-400 hover:text-sky-300"
            >
              忘记密码？
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors"
          >
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="text-center text-sm text-white/50">
            还没有账号？
            <Link to="/signup" className="text-sky-400 hover:text-sky-300 ml-1">
              创建账号
            </Link>
          </div>

          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/30 text-xs">内部员工</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <Link
            to="/login/feishu"
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 rounded-xl text-sm transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            飞书登录（内部员工）
          </Link>
        </form>
      </div>
    </div>
  );
}
