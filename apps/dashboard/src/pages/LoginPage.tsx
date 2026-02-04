import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import axios from 'axios';

const N8N_WEBHOOK_BASE = import.meta.env.VITE_N8N_WEBHOOK_BASE || 'http://localhost:5679/webhook';

export default function LoginPage() {
  const { platform, accountId } = useParams<{ platform: string; accountId: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'idle' | 'loading' | 'showing_qr' | 'success' | 'error'>('idle');
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(false);

  // 获取二维码
  const fetchQrCode = useCallback(async () => {
    try {
      setStatus('loading');
      setError('');
      setQrCodeUrl(null);

      const response = await axios.post(`${N8N_WEBHOOK_BASE}/douyin-login`, {
        action: 'get-qrcode'
      });

      const data = response.data;

      // 处理 n8n 返回的数据 (可能是 {stdout: "..."} 或直接是 {success, qrcode_base64})
      let result = data;
      if (data.stdout && typeof data.stdout === 'string') {
        try {
          result = JSON.parse(data.stdout);
        } catch {
          result = data;
        }
      }

      if (result.success && result.qrcode_base64) {
        // 设置二维码图片 URL
        const base64Data = result.qrcode_base64;
        const imageUrl = base64Data.startsWith('data:')
          ? base64Data
          : `data:image/png;base64,${base64Data}`;

        setQrCodeUrl(imageUrl);
        setMessage(result.message || '请使用抖音 APP 扫描二维码登录');
        setStatus('showing_qr');
      } else {
        throw new Error(result.error || '获取二维码失败');
      }
    } catch (err: any) {
      console.error('Failed to get QR code:', err);
      setError(err.message || '获取二维码失败，请重试');
      setStatus('error');
    }
  }, []);

  // 检查登录状态
  const checkLoginStatus = useCallback(async () => {
    try {
      setCheckingStatus(true);

      const response = await axios.post(`${N8N_WEBHOOK_BASE}/douyin-login`, {
        action: 'check-status'
      });

      const data = response.data;

      // 处理 n8n 返回的数据
      let result = data;
      if (data.stdout && typeof data.stdout === 'string') {
        try {
          result = JSON.parse(data.stdout);
        } catch {
          result = data;
        }
      }

      if (result.success && result.status === 'logged_in') {
        setStatus('success');
        setMessage('登录成功！Cookie 已保存');

        // 3 秒后跳转回账号管理页
        setTimeout(() => {
          navigate('/accounts');
        }, 3000);
        return true;
      } else if (result.status === 'expired' || result.status === 'failed') {
        // 二维码过期，需要重新获取
        setMessage('二维码已过期，请重新获取');
        setQrCodeUrl(null);
        setStatus('idle');
        return false;
      }

      return false;
    } catch (err) {
      console.error('Failed to check login status:', err);
      return false;
    } finally {
      setCheckingStatus(false);
    }
  }, [navigate]);

  // 轮询检查登录状态
  useEffect(() => {
    if (status === 'showing_qr') {
      const interval = setInterval(async () => {
        const loggedIn = await checkLoginStatus();
        if (loggedIn) {
          clearInterval(interval);
        }
      }, 3000);

      // 2 分钟后停止轮询（二维码过期）
      const timeout = setTimeout(() => {
        clearInterval(interval);
        if (status === 'showing_qr') {
          setMessage('二维码已过期，请点击刷新重新获取');
        }
      }, 120000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [status, checkLoginStatus]);

  // 页面加载时自动获取二维码
  useEffect(() => {
    if (platform === 'douyin') {
      fetchQrCode();
    }
  }, [platform, fetchQrCode]);

  const getPlatformName = (p: string) => {
    const names: Record<string, string> = {
      douyin: '抖音',
      xhs: '小红书',
      weibo: '微博',
      toutiao: '今日头条',
      shipin: '视频号'
    };
    return names[p] || p;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {/* 返回按钮 */}
        <button
          onClick={() => navigate('/accounts')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回账号管理
        </button>

        {/* 标题 */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {getPlatformName(platform || '')} 账号登录
          </h2>
          {accountId && (
            <p className="text-gray-600 text-sm">
              账号: {accountId}
            </p>
          )}
        </div>

        {/* 状态显示 */}
        <div className="mb-6">
          {status === 'idle' && (
            <div className="text-center">
              <p className="text-gray-700 mb-6">
                点击下方按钮获取登录二维码
              </p>
              <button
                onClick={fetchQrCode}
                className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                获取二维码
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
              <p className="text-gray-700">正在获取二维码...</p>
            </div>
          )}

          {status === 'showing_qr' && qrCodeUrl && (
            <div className="text-center">
              {/* 二维码图片 */}
              <div className="bg-white border-2 border-gray-200 rounded-lg p-4 mb-4 inline-block">
                <img
                  src={qrCodeUrl}
                  alt="登录二维码"
                  className="w-64 h-64 mx-auto"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
                <p className="text-blue-800 font-medium mb-1">
                  {message}
                </p>
                <p className="text-blue-600 text-sm flex items-center justify-center">
                  {checkingStatus ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      正在检查登录状态...
                    </>
                  ) : (
                    '扫码后将自动检测登录状态'
                  )}
                </p>
              </div>

              {/* 刷新按钮 */}
              <button
                onClick={fetchQrCode}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                刷新二维码
              </button>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
                <p className="text-green-800 font-medium mb-2">
                  登录成功！
                </p>
                <p className="text-green-700 text-sm">
                  {message}
                </p>
              </div>
              <p className="text-gray-600 text-sm">
                3 秒后自动跳转回账号管理页面...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-8">
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
                <p className="text-red-800 font-medium mb-2">
                  获取二维码失败
                </p>
                <p className="text-red-700 text-sm">
                  {error}
                </p>
              </div>
              <button
                onClick={fetchQrCode}
                className="w-full inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                重新尝试
              </button>
            </div>
          )}
        </div>

        {/* 非抖音平台提示 */}
        {platform && platform !== 'douyin' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <p className="text-yellow-800 text-sm">
              暂时只支持抖音平台的二维码登录，其他平台即将支持。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
