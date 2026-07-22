import { Link } from 'react-router-dom';

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-grid">
        <section className="card">
          <span className="pill">Staff Hub</span>
          <h1 style={{ fontSize: '2.6rem', marginTop: 18 }}>员工中心</h1>
          <p className="muted" style={{ fontSize: '1.05rem', lineHeight: 1.7 }}>
            这是跟客户前端彻底分开的内部站点。这里承载 Skill 验收与 ZenithJoy 自身 Path 健康观察，
            只给员工账号使用。
          </p>
          <div className="path-grid" style={{ marginTop: 24 }}>
            <div className="list-row">
              <h3>Skill 验收</h3>
              <p className="muted">上传 zip、轮询 mmv 执行结果、直接看真实 HTML 报告。</p>
            </div>
            <div className="list-row">
              <h3>Path 健康</h3>
              <p className="muted">聚合 Brain feature 状态与 GitHub Actions smoke 成败。</p>
            </div>
          </div>
        </section>

        <section className="card">
          <span className="pill">仅员工可用</span>
          <h2 style={{ marginTop: 18 }}>飞书登录</h2>
          <p className="muted">
            登录成功后进入独立员工工作区。未命中白名单的账号即使已登录，也无法通过 staff API。
          </p>
          <div className="actions" style={{ marginTop: 24 }}>
            <Link className="button primary" to="/login/feishu">
              使用飞书登录
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
