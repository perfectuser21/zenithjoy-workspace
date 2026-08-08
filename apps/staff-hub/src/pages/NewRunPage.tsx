import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { adminFetch } from '../lib/adminFetch';
import { useAuth } from '../contexts/AuthContext';

// mandatory 场景码列表（与 acceptance-spec/line02-android.yaml 中 scenario_class: mandatory 对齐）
const MANDATORY_SCENARIOS = ['S1', 'S4', 'S5', 'S6', 'S7'];

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function NewRunPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tenantAccount, setTenantAccount] = useState('');
  const [phoneModel, setPhoneModel] = useState('');
  const [clientId, setClientId] = useState('');
  const [taskNo, setTaskNo] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [scenariosObserved, setScenariosObserved] = useState<string[]>([]);
  const [deviceRebootAt, setDeviceRebootAt] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState('');

  const missingMandatory = MANDATORY_SCENARIOS.filter((s) => !scenariosObserved.includes(s));
  const canSubmit = missingMandatory.length === 0;
  const s4Selected = scenariosObserved.includes('S4');

  const handleScenarioToggle = (scenario: string) => {
    setScenariosObserved((prev) =>
      prev.includes(scenario)
        ? prev.filter((s) => s !== scenario)
        : [...prev, scenario]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitState('submitting');
    setSubmitError('');

    try {
      const body: Record<string, unknown> = {
        gp_id: '7790f728-f490-4243-b166-03f3250a0938',
        tenant_account: tenantAccount,
        phone_model: phoneModel,
        client_id: clientId,
        task_no: taskNo,
        passphrase,
        scenarios_observed: scenariosObserved,
      };
      if (deviceRebootAt) {
        body.device_reboot_at = deviceRebootAt;
      }

      const res = await adminFetch('/api/staff/acceptance/create-run', user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('create-run failed');
      setSubmitState('success');
      navigate('/acceptance');
    } catch {
      setSubmitState('error');
      setSubmitError('提交失败，请重试');
    }
  };

  return (
    <div>
      <Link to="/acceptance">← 返回验收列表</Link>
      <h1>发起新验收</h1>

      <form
        data-testid="new-run-form"
        onSubmit={(e) => void handleSubmit(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}
      >
        <div>
          <label>测试用客户账号（验收专用租户）</label>
          <select
            data-testid="new-run-tenant-account"
            value={tenantAccount}
            onChange={(e) => setTenantAccount(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          >
            <option value="">请选择</option>
            <option value="test-tenant-1">测试租户 1</option>
            <option value="test-tenant-2">测试租户 2</option>
          </select>
        </div>

        <div>
          <label>手机型号</label>
          <input
            data-testid="new-run-phone-model"
            type="text"
            value={phoneModel}
            onChange={(e) => setPhoneModel(e.target.value)}
            placeholder="例：小米 14 Pro"
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          />
        </div>

        <div>
          <label>客户端编号</label>
          <input
            data-testid="new-run-client-id"
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="客户端状态页里能看到"
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          />
        </div>

        <div>
          <label>本轮任务编号</label>
          <input
            data-testid="new-run-task-no"
            type="text"
            value={taskNo}
            onChange={(e) => setTaskNo(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          />
        </div>

        <div>
          <label>本轮暗号</label>
          <input
            data-testid="new-run-passphrase"
            type="text"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="【暗号-年月日-时分-缩写】…"
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          />
        </div>

        <div>
          <label>场景码（mandatory 场景码必须全部勾选）</label>
          <div
            data-testid="new-run-scenarios-observed"
            style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}
          >
            {MANDATORY_SCENARIOS.map((scenario) => (
              <label key={scenario} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="checkbox"
                  value={scenario}
                  data-scenario={scenario}
                  checked={scenariosObserved.includes(scenario)}
                  onChange={() => handleScenarioToggle(scenario)}
                />
                {scenario}（必选）
              </label>
            ))}
          </div>
          {!canSubmit && (
            <p style={{ color: '#d64545', fontSize: '13px', marginTop: '6px' }}>
              请勾选所有必选场景（{missingMandatory.length}个未勾选）
            </p>
          )}
        </div>

        <div>
          <label>
            设备重启时间
            {s4Selected && <span style={{ color: '#d64545' }}> *（S4 场景必填）</span>}
          </label>
          <input
            data-testid="new-run-device-reboot-at"
            type="text"
            value={deviceRebootAt}
            onChange={(e) => setDeviceRebootAt(e.target.value)}
            required={s4Selected}
            aria-required={s4Selected ? 'true' : 'false'}
            placeholder="例：2026-08-08 10:00"
            style={{ display: 'block', width: '100%', marginTop: '4px' }}
          />
        </div>

        <div>
          <button
            data-testid="new-run-submit"
            type="submit"
            disabled={!canSubmit || submitState === 'submitting'}
          >
            {submitState === 'submitting' ? '提交中...' : '发起验收'}
          </button>
          {submitState === 'error' && (
            <p style={{ color: '#d64545', marginTop: '8px' }}>{submitError}</p>
          )}
        </div>
      </form>
    </div>
  );
}
