import { Activity, FileCheck2, ShieldCheck } from 'lucide-react';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="card">
          <span className="pill">独立员工前台</span>
          <h1 style={{ fontSize: '2.2rem', marginTop: 18 }}>Staff Hub 第一刀已切开</h1>
          <p className="muted" style={{ lineHeight: 1.7 }}>
            这个站点跟客户 Dashboard 分离，只承载员工内部能力。当前先落两条主线：
            Skill 验收迁移，以及 ZenithJoy 自身 Path1/2/4 健康观察。
          </p>
          <div className="actions" style={{ marginTop: 18 }}>
            <a className="button primary" href="/skill-eval">去 Skill 验收</a>
            <a className="button secondary" href="/path-health">看 Path 健康</a>
          </div>
        </div>
        <div className="card">
          <h2>当班纪律</h2>
          <div className="list">
            <div className="list-row">
              <ShieldCheck size={18} />
              <p className="muted">员工鉴权走飞书 + staff API 白名单，客户前台不再挂员工入口。</p>
            </div>
            <div className="list-row">
              <FileCheck2 size={18} />
              <p className="muted">评测执行体继续在 mmv，Staff Hub 不引入任何 LLM SDK 直连。</p>
            </div>
            <div className="list-row">
              <Activity size={18} />
              <p className="muted">Path 健康卡片基于真实 Brain feature 与 GitHub smoke 数据，失败必须诚实显示。</p>
            </div>
          </div>
        </div>
      </section>

      <section className="kpi-grid">
        <div className="card">
          <h3>Skill 验收</h3>
          <p className="muted">上传 skill zip，跟踪任务状态，直接查看 Cecelia HTML 报告。</p>
        </div>
        <div className="card">
          <h3>Path 观察</h3>
          <p className="muted">Path1 / Path2 / Path4 三条核心内部链路的最近 smoke 与 feature 状态。</p>
        </div>
        <div className="card">
          <h3>独立部署位</h3>
          <p className="muted">独立 app、独立登录、独立域名位，后续客户管理不混入本刀。</p>
        </div>
      </section>
    </>
  );
}
