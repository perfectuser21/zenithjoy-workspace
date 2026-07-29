/**
 * EnvBadge.tsx - 环境角标
 *
 * 让员工一眼看出当前打开的是 staging 还是生产，:9443/:9444 两个端口太容易混：
 *   · 生产（production / 不设）→ 不显示任何标志
 *   · staging → 右上角橙色 "STAGING" 旗
 *   · dev → 右上角蓝色 "DEV" 旗
 *
 * 环境靠 build 时注入的 VITE_DEPLOY_ENV 判断（最可靠）：
 *   - deploy-staff-hub-staging.yml 注入 VITE_DEPLOY_ENV=staging
 *   - promote-staff-hub-prod-hk.yml 注入 VITE_DEPLOY_ENV=production
 *   - 本地 dev（npm run dev）不设 → 退回 import.meta.env.DEV 判定为 DEV 旗
 *
 * 视觉/逻辑照搬 apps/dashboard/src/components/EnvBadge.tsx 已验证过的模式，
 * 只改了 title 里的生产地址提示。
 */

type EnvFlag = { text: string; color: string };

function readDeployEnv(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_DEPLOY_ENV || '').toLowerCase();
}

/** 返回当前环境对应的角标配置；生产返回 null（不显示）。 */
export function resolveEnvFlag(): EnvFlag | null {
  const deployEnv = readDeployEnv();

  if (deployEnv === 'staging') {
    return { text: 'STAGING', color: '#f97316' }; // 橙
  }
  if (deployEnv === 'dev' || deployEnv === 'development') {
    return { text: 'DEV', color: '#3b82f6' }; // 蓝
  }
  // 显式生产 → 干净，不显示
  if (deployEnv === 'production' || deployEnv === 'prod') {
    return null;
  }
  // 未注入 VITE_DEPLOY_ENV：本地 vite dev 服务器显示 DEV，生产 build 保持干净
  if (import.meta.env.DEV) {
    return { text: 'DEV', color: '#3b82f6' };
  }
  return null;
}

export default function EnvBadge() {
  const flag = resolveEnvFlag();
  if (!flag) return null;

  return (
    <div
      data-testid="env-badge"
      title={`${flag.text} 环境 · 非生产（生产地址：staff.zenjoymedia.media:9443）`}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 74,
        height: 74,
        overflow: 'hidden',
        zIndex: 2147483647,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 13,
          right: -26,
          transform: 'rotate(45deg)',
          width: 96,
          textAlign: 'center',
          background: flag.color,
          color: '#fff',
          font: '600 9px/1 -apple-system,system-ui,sans-serif',
          letterSpacing: '.5px',
          padding: '3px 0',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }}
      >
        {flag.text}
      </div>
    </div>
  );
}
