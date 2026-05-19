import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const CARD_CLASS = 'bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700';

const SettingsPage: React.FC = () => {
  const { isSuperAdmin } = useAuth();

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">设置</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to="/license" className={CARD_CLASS}>
          <KeyRound className="w-10 h-10 text-blue-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">License</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">查看和管理你的授权许可</p>
        </Link>

        {isSuperAdmin && (
          <Link to="/admin/license" className={CARD_CLASS}>
            <ShieldCheck className="w-10 h-10 text-purple-500 mb-3" />
            <h3 className="font-medium text-gray-900 dark:text-white mb-1">管理员专区</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">License 管理与会员管理</p>
          </Link>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
