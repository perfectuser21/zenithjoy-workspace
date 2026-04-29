/**
 * ForgotPassword — 忘记密码页面（PR-3）
 *
 * 提交 → POST /api/auth/request-password-reset
 * 始终显示"如果该邮箱存在，你会收到重置链接" — 不暴露邮箱是否注册（防枚举攻击）
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { requestPasswordReset } from '../api/better-auth.api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('请填写邮箱');
      return;
    }

    setLoading(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      await requestPasswordReset({
        email: email.trim(),
        redirectTo: `${origin}/reset-password`,
      });
      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败，请重试';
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
          <h1 className="text-2xl font-bold text-white">忘记密码</h1>
          <p className="text-white/50 text-sm mt-2">
            输入邮箱，我们会发重置链接给你
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

          {submitted && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <p className="text-emerald-300 text-sm">
                如果该邮箱存在，你会收到一封重置密码邮件，请查收。
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="fp-email"
              className="block text-white/70 text-sm mb-2"
            >
              邮箱
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                id="fp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={submitted}
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || submitted}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors"
          >
            {loading ? '发送中...' : '发送重置链接'}
          </button>

          <div className="text-center text-sm text-white/50">
            想起来了？
            <Link to="/login" className="text-sky-400 hover:text-sky-300 ml-1">
              返回登录
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
