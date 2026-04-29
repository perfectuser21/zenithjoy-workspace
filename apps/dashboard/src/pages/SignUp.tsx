/**
 * SignUp — 邮箱+密码注册页面（PR-3）
 *
 * 提交 → POST /api/auth/sign-up/email
 * autoSignIn: true（后端配置）→ 注册成功直接登录
 * 成功后 login() + 跳 /
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { signUpEmail } from '../api/better-auth.api';

export default function SignUp() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // 客户端校验：必填字段
    if (!email.trim() || !password.trim() || !name.trim()) {
      setError('请填写邮箱、密码和姓名');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }

    setLoading(true);
    try {
      const result = await signUpEmail({
        email: email.trim(),
        password,
        name: name.trim(),
        license_key: licenseKey.trim() || undefined,
      });
      // 调 login() 同步 AuthContext（同时回写 cookie，与现有飞书登录一致）
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
      const msg = err instanceof Error ? err.message : '注册失败，请重试';
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
          <h1 className="text-2xl font-bold text-white">创建账号</h1>
          <p className="text-white/50 text-sm mt-2">
            注册一个新账号，开启你的运营之旅
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
              htmlFor="su-email"
              className="block text-white/70 text-sm mb-2"
            >
              邮箱
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="su-email"
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
              htmlFor="su-password"
              className="block text-white/70 text-sm mb-2"
            >
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="su-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50"
              />
            </div>
          </div>

          {/* 姓名 */}
          <div>
            <label
              htmlFor="su-name"
              className="block text-white/70 text-sm mb-2"
            >
              姓名
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="su-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的称呼"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50"
              />
            </div>
          </div>

          {/* license_key（可选） */}
          <div>
            <label
              htmlFor="su-license"
              className="block text-white/70 text-sm mb-2"
            >
              License Key（可选）
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="su-license"
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="ZJ-M-XXXXXXXX"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50"
              />
            </div>
            <p className="text-xs text-white/40 mt-1">
              如果你购买了 license，请填这里以加入团队
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors"
          >
            {loading ? '注册中...' : '创建账号'}
          </button>

          <div className="text-center text-sm text-white/50">
            已有账号？
            <Link to="/login" className="text-sky-400 hover:text-sky-300 ml-1">
              去登录
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
