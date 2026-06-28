/**
 * CsAreaEntryPage — 私域客服区入口分诊（以号为中心 IA 重设计 刀2）
 *
 * 侧栏「私域客服」(/area/wechat) 落这里，按角色/号数分诊：
 *   - 超管/老板（isSuperAdmin）→ 客服号总览（看全公司号）
 *   - 普通运营，名下正好 1 个号 → 直接进自己那个号的工作台（跳过总览）
 *   - 普通运营，名下多个号 / 0 个号 → 总览（自己挑/空态引导）
 * 号列表用既有 scoped 接口 GET /api/wechat/cs/machines（运营只拿到自己的号）。
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { listCSMachines, type CSMachine } from '../api/wechat-cs-config.api';
import CsAccountOverviewPage from './CsAccountOverviewPage';

export default function CsAreaEntryPage() {
  const { isSuperAdmin } = useAuth();
  const [machines, setMachines] = useState<CSMachine[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listCSMachines()
      .then((list) => {
        if (!cancelled) setMachines(list);
      })
      .catch(() => {
        if (!cancelled) setMachines([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (machines === null) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="cs-entry-loading">
        <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
      </div>
    );
  }

  // 普通运营 + 正好 1 个号 → 直接进该号工作台（不让运营多点一层总览）。
  if (!isSuperAdmin && machines.length === 1) {
    return <Navigate to={`/wechat/account/${encodeURIComponent(machines[0].machine_id)}`} replace />;
  }

  // 超管 / 多号 / 空 → 总览。
  return <CsAccountOverviewPage />;
}
