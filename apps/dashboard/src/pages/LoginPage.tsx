import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  const { platform, accountId } = useParams<{ platform: string; accountId: string }>();
  const navigate = useNavigate();

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
        <button
          onClick={() => navigate('/accounts')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回账号管理
        </button>

        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {getPlatformName(platform || '')} 账号登录
          </h2>
          {accountId && (
            <p className="text-gray-600 text-sm">账号: {accountId}</p>
          )}
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6 text-center">
          <p className="text-yellow-800 font-medium mb-2">功能维护中</p>
          <p className="text-yellow-700 text-sm">扫码登录功能暂不可用，请联系管理员。</p>
        </div>
      </div>
    </div>
  );
}
