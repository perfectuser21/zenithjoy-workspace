import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { feishuLogin } from '../api/feishuLogin';

interface QRLoginObj {
  matchOrigin: (origin: string) => boolean;
  matchData: (data: unknown) => boolean;
}

declare global {
  interface Window {
    QRLogin?: (config: {
      id: string;
      goto: string;
      width: number;
      height: number;
      style?: string;
    }) => QRLoginObj;
  }
}

export default function FeishuLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const scriptLoadedRef = useRef(false);

  const appId = import.meta.env.VITE_FEISHU_APP_ID;
  // 用实际访问协议(window.location.origin)，不强制转https——服务器现在只提供http，
  // 硬编码转https会导致发给飞书的redirect_uri和真实回调地址协议不一致，飞书直接拒绝
  // (Error 20029 Invalid redirect URL)。生产走真HTTPS后这里会自然是https，不用改代码。
  const redirectUri = `${window.location.origin}/login/feishu`;

  const handleFeishuCallback = useCallback(async (code: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await feishuLogin(code);
      if (data.success && data.user) {
        login(data.user, data.user.access_token);
        navigate('/');
        return;
      }
      throw new Error(data.error || '登录失败');
    } catch {
      setError('飞书登录失败，请重试');
      setLoading(false);
    }
  }, [login, navigate]);

  useEffect(() => {
    const code = searchParams.get('code');
    if (code) void handleFeishuCallback(code);
  }, [handleFeishuCallback, searchParams]);

  useEffect(() => {
    if (searchParams.get('code')) return;
    if (!appId) {
      setError('缺少 VITE_FEISHU_APP_ID');
      return;
    }
    if (scriptLoadedRef.current) return;
    scriptLoadedRef.current = true;

    const script = document.createElement('script');
    script.src = 'https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js';
    script.async = true;

    // 扫码成功后飞书组件不会自己跳转，而是通过 postMessage 把 tmp_code 发给本页面，
    // 页面自己校验来源+拼接 tmp_code 后跳去 goto 地址——这一步之前漏了，扫码显示成功
    // 但页面停在原地不动就是因为没有这个监听 (matchOrigin/matchData 是飞书SDK返回对象的方法)。
    let qrLoginObj: QRLoginObj | undefined;
    const handleMessage = (event: MessageEvent) => {
      if (!qrLoginObj) return;
      if (!qrLoginObj.matchOrigin(event.origin) || !qrLoginObj.matchData(event.data)) return;
      const tmpCode = (event.data as { tmp_code?: string }).tmp_code;
      if (!tmpCode) return;
      const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=STATE&tmp_code=${tmpCode}`;
      window.location.href = goto;
    };
    window.addEventListener('message', handleMessage);

    script.onload = () => {
      const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=STATE`;
      qrLoginObj = window.QRLogin?.({
        id: 'feishu-qr-container',
        goto,
        width: 280,
        height: 280,
        style: 'border:none;background:white;',
      });
    };
    script.onerror = () => setError('飞书登录组件加载失败');
    document.body.appendChild(script);

    return () => window.removeEventListener('message', handleMessage);
  }, [appId, redirectUri, searchParams]);

  const directAuthUrl = appId
    ? `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=STATE`
    : '#';

  return (
    <div className="login-wrap">
      <div className="login-grid">
        <section className="card">
          <span className="pill">Staff Hub Login</span>
          <h1 style={{ fontSize: '2.3rem', marginTop: 18 }}>飞书扫码进入员工中心</h1>
          <p className="muted">
            登录成功后会直接进入 Staff Hub。这个站点只给员工用，不与客户 Dashboard 共用导航与入口。
          </p>
        </section>

        <section className="card">
          {loading ? <p>正在登录...</p> : null}
          {error ? <div className="error">{error}</div> : null}
          {!searchParams.get('code') ? (
            <>
              <div id="feishu-qr-container" style={{ minHeight: 300 }} />
              <div className="actions" style={{ marginTop: 18 }}>
                <a className="button secondary" href={directAuthUrl}>
                  无法扫码时改用跳转登录
                </a>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
