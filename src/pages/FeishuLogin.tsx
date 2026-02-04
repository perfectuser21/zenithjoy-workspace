import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstance } from '../contexts/InstanceContext';
import { BarChart3, Shield, Zap, RefreshCw, Smartphone, ExternalLink } from 'lucide-react';

// 声明全局 QRLogin 函数类型
declare global {
  interface Window {
    QRLogin: (config: {
      id: string;
      goto: string;
      width: number;
      height: number;
      style?: string;
    }) => {
      matchOrigin: (origin: string) => boolean;
      matchData: (data: { tmp_code?: string }) => boolean;
    };
  }
}

// 飞书登录页面
export default function FeishuLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { isCore } = useInstance();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [qrReady, setQrReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrKey, setQrKey] = useState(0);
  const qrLoginRef = useRef<ReturnType<typeof window.QRLogin> | null>(null);
  const scriptLoadedRef = useRef(false);

  // 飞书应用配置（从环境变量读取）
  const APP_ID = import.meta.env.VITE_FEISHU_APP_ID;
  // 动态 redirect_uri：使用当前域名（需要在飞书应用后台配置所有域名）
  const origin = window.location.origin.replace(/^http:/, 'https:');
  const REDIRECT_URI = `${origin}/login`;

  // 处理飞书登录回调
  const handleFeishuCallback = async (code: string) => {
    setLoading(true);
    setError('');

    try {
      console.log('Received code from Feishu:', code);

      // 调用后端 API 处理飞书登录（后端有 app_secret）
      const response = await fetch(`/api/feishu-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      console.log('Backend response:', data);

      if (data.success && data.user) {
        console.log('Login successful, user data:', data.user);
        console.log('Your Feishu ID:', data.user.feishu_user_id);
        login(data.user, data.user.access_token);
        navigate('/');
      } else {
        throw new Error(data.error || '登录失败');
      }
    } catch (err) {
      console.error('Feishu login error:', err);
      setError('登录失败，请重试');
      setLoading(false);
    }
  };

  // 初始化二维码
  const initQRCode = useCallback(() => {
    if (typeof window.QRLogin !== 'function') {
      setError('飞书登录组件未加载');
      return;
    }

    // 检查容器是否已有内容（避免重复初始化）
    const container = document.getElementById('feishu-qr-container');
    if (!container) return;
    if (container.querySelector('iframe')) {
      // 已经有二维码了，不重复初始化
      setQrReady(true);
      return;
    }

    // 构造授权地址（QR 码 SDK 必须使用 passport 端点才能收到 tmp_code）
    const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=STATE`;

    try {
      qrLoginRef.current = window.QRLogin({
        id: 'feishu-qr-container',
        goto: goto,
        width: 300,
        height: 300,
        style: 'border:none;background:white;',
      });
      setQrReady(true);
      setError('');
    } catch (err) {
      console.error('QRLogin init error:', err);
      setError('初始化登录二维码失败');
    }
  }, [APP_ID, REDIRECT_URI]);

  // 飞书一键登录 - 使用开放平台 OAuth 接口（原来能工作的方式）
  const handleClickLogin = useCallback(() => {
    const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=STATE`;
    window.location.href = authUrl;
  }, [APP_ID, REDIRECT_URI]);

  // 刷新二维码 - 通过改变 key 让 React 重建容器
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setQrReady(false);
    qrLoginRef.current = null;
    setQrKey(k => k + 1);
    setTimeout(() => {
      initQRCode();
      setRefreshing(false);
    }, 300);
  }, [initQRCode]);

  // 检查是否有 code 参数（飞书回调）
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      handleFeishuCallback(code);
    }
  }, [searchParams]);

  // 加载飞书扫码 SDK 并初始化二维码
  useEffect(() => {
    // 如果已经有 code，不需要显示二维码
    if (searchParams.get('code')) return;
    if (!APP_ID) return;
    // 防止 StrictMode 重复加载
    if (scriptLoadedRef.current) {
      // 如果脚本已加载，直接初始化二维码
      if (typeof window.QRLogin === 'function') {
        initQRCode();
      }
      return;
    }

    scriptLoadedRef.current = true;

    // 检查是否已存在脚本
    const existingScript = document.querySelector('script[src*="LarkSSOSDKWebQRCode"]');
    if (existingScript && typeof window.QRLogin === 'function') {
      initQRCode();
      return;
    }

    // 动态加载飞书 SDK
    const script = document.createElement('script');
    script.src = 'https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js';
    script.async = true;
    script.onload = () => {
      initQRCode();
    };
    script.onerror = () => {
      setError('加载飞书登录组件失败');
      scriptLoadedRef.current = false;
    };
    document.body.appendChild(script);

    // 不在 cleanup 中移除脚本，避免 StrictMode 问题
  }, [APP_ID, searchParams, initQRCode]);

  // 监听扫码成功事件
  useEffect(() => {
    if (!qrReady || !qrLoginRef.current) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const qrLogin = qrLoginRef.current;
        if (!qrLogin || !qrLogin.matchOrigin(event.origin)) return;

        // 支持多种数据格式
        let tmpCode: string | undefined;
        const data = event.data;

        if (typeof data === 'string') {
          // 旧格式：event.data 直接是 tmp_code 字符串
          tmpCode = data;
        } else if (typeof data === 'object' && data !== null) {
          // 新格式1：{ tmp_code: "..." }
          if (data.tmp_code) {
            tmpCode = data.tmp_code;
          }
          // 新格式2：{ qrlogin: { token: "..." } }
          else if (data.qrlogin?.token) {
            tmpCode = data.qrlogin.token;
          }
        }

        if (tmpCode) {
          console.log('Received tmp_code:', tmpCode);
          // 使用 tmp_code 跳转完成授权
          const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=STATE`;
          window.location.href = `${goto}&tmp_code=${tmpCode}`;
        }
      } catch (err) {
        console.error('Message handling error:', err);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [qrReady, APP_ID, REDIRECT_URI]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{
        background: isCore
          ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
          : 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)'
      }}>
        <div className="text-center">
          <img src="/logo-white.png" alt="Logo" className="h-14 mx-auto mb-8" />
          <p className="text-white/80 text-lg mb-6">正在为你准备一切...</p>
          {/* 品牌进度条 */}
          <div className="w-48 h-1 mx-auto bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                background: isCore
                  ? 'linear-gradient(90deg, #475569, #64748b, #94a3b8)'
                  : 'linear-gradient(90deg, #3467D6, #3C8CFD, #01C7D2)',
                animation: 'progressSlide 1.5s ease-in-out infinite',
              }}
            />
          </div>
          <style>{`
            @keyframes progressSlide {
              0% { width: 0%; margin-left: 0%; }
              50% { width: 60%; margin-left: 20%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: isCore ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' : 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)' }}>
      {/* 左侧 - 品牌展示区 */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between p-12 relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className={`absolute -top-40 -left-40 w-80 h-80 rounded-full opacity-10 ${isCore ? 'bg-slate-400' : 'bg-blue-500'}`} />
          <div className={`absolute top-1/3 -right-20 w-60 h-60 rounded-full opacity-10 ${isCore ? 'bg-slate-300' : 'bg-sky-400'}`} />
          <div className={`absolute -bottom-20 left-1/4 w-40 h-40 rounded-full opacity-5 ${isCore ? 'bg-slate-200' : 'bg-cyan-400'}`} />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <img src="/logo-white.png" alt="悦升云端科技" className="h-16" />
        </div>

        {/* 主标语 */}
        <div className="relative z-10 max-w-lg">
          <h2 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-6">
            回来啦
            <br />
            <span className={isCore ? 'text-slate-300' : 'text-sky-400'}>这里一直等着你</span>
          </h2>
          <p className="text-white/60 text-lg leading-relaxed">
            你的专属空间，熟悉的工具，顺手的节奏。
          </p>
        </div>

        {/* 特性展示 */}
        <div className="relative z-10 grid grid-cols-3 gap-6">
          {[
            { icon: BarChart3, label: '数据都在', desc: '随时查看' },
            { icon: Shield, label: '账号放心', desc: '统一守护' },
            { icon: Zap, label: '简单顺手', desc: '少点折腾' },
          ].map((item, i) => (
            <div key={i} className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
              <item.icon className={`w-6 h-6 mb-3 ${isCore ? 'text-slate-300' : 'text-sky-400'}`} />
              <p className="text-white font-medium">{item.label}</p>
              <p className="text-white/50 text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧 - 登录区 */}
      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="lg:hidden text-center mb-10">
            <img src="/logo-white.png" alt="悦升云端科技" className="h-12 mx-auto" />
          </div>

          {/* 登录卡片 */}
          <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl">
            <div className="text-center mb-6">
              <h3 className="text-2xl font-bold text-white mb-2">欢迎回家</h3>
              <p className="text-white/50">用飞书扫码，一键进入</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>
            )}

            {/* 飞书扫码二维码容器 */}
            <div className="flex flex-col items-center mb-6">
              {/* 二维码外框 - 210px 显示区域 */}
              <div className={`rounded-2xl border-2 ${isCore ? 'border-slate-400/50' : 'border-sky-400/50'} bg-white p-2`}>
                {/* 裁剪容器 */}
                <div style={{ width: 210, height: 210, overflow: 'hidden', borderRadius: 8 }}>
                  {/* SDK 生成 300x300，缩放到 70% = 210px */}
                  <div
                    key={qrKey}
                    id="feishu-qr-container"
                    className="[&_iframe]:!border-0 [&_iframe]:!outline-none [&_iframe]:block"
                    style={{ width: 300, height: 300, transform: 'scale(0.7)', transformOrigin: 'top left' }}
                  >
                    {(!qrReady || refreshing) && !error && (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 rounded-lg">
                        <div className={`animate-spin rounded-full h-8 w-8 border-2 border-t-transparent mb-3 ${isCore ? 'border-slate-500' : 'border-blue-600'}`}></div>
                        <p className="text-gray-400 text-sm">{refreshing ? '刷新中...' : '加载中...'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 刷新按钮 */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="mt-6 flex items-center gap-2 px-4 py-2 text-sm text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>刷新二维码</span>
              </button>
            </div>

            {/* 一键登录按钮 */}
            <button
              onClick={handleClickLogin}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                isCore
                  ? 'bg-slate-600 hover:bg-slate-500 text-white'
                  : 'bg-blue-700 hover:bg-blue-600 text-white'
              }`}
            >
              <ExternalLink className="w-5 h-5" />
              飞书一键登录
            </button>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/30 text-xs">或</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* 提示文字 */}
            <div className="text-center">
              <p className="text-white/50 text-sm flex items-center justify-center gap-2">
                <Smartphone className="w-4 h-4" />
                扫描上方二维码
              </p>
            </div>

            {/* 说明文字 */}
            <p className="text-center text-white/40 text-sm leading-relaxed mt-4">
              遇到问题？随时找我们
            </p>
          </div>

          {/* 底部版权 */}
          <p className="text-center text-white/30 text-xs mt-8">
            © 2025 悦升云端科技 ZenithJoy
          </p>
        </div>
      </div>
    </div>
  );
}
