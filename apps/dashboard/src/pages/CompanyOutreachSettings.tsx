import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getOutreachSettings, saveOutreachSettings, type OutreachSettings } from '../api/company-profile.api';

const initial: OutreachSettings = { daily_cap: 80, start_local: '00:00', end_local: '00:00', paused: false, revision: 0 };
const inputStyle = { display: 'block', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, width: '100%', backgroundColor: '#fff', color: '#111827' } as const;

export function CompanyOutreachSettings() {
  const [saved, setSaved] = useState<OutreachSettings | null>(null);
  const [form, setForm] = useState<OutreachSettings>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNow, setSavedNow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSavedNow(false);
    try {
      const result = await getOutreachSettings() ?? initial;
      setSaved(result);
      setForm(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '触达设置读取失败');
      setSaved(null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSavedNow(false);
    try {
      const result = await saveOutreachSettings(form);
      setSaved(result);
      setForm(result);
      setSavedNow(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '触达设置保存失败');
    } finally { setSaving(false); }
  }

  return <section aria-labelledby="outreach-settings-heading" style={{ maxWidth: 600 }}>
    <h2 id="outreach-settings-heading">抖音触达设置</h2>
    <p>用于智能获客 104。保存后写入数据库，下一次运行读取新设置。</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>正在读取触达设置…</p> : saved && <>
      <p>{saved.revision ? (saved.paused ? '已暂停' : '未暂停') + ' · 版本 ' + saved.revision : '尚未保存 · 表单预填每日 80 条、全天'}</p>
      <form onSubmit={submit} onChange={() => setSavedNow(false)} style={{ display: 'grid', gap: 14 }}>
        <label>每日发送上限
          <input style={inputStyle} type="number" min={1} max={1000} step={1} required value={form.daily_cap || ''}
            onChange={event => setForm({ ...form, daily_cap: Number(event.target.value) })} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label>开始时间
            <input style={inputStyle} type="time" required value={form.start_local} onChange={event => setForm({ ...form, start_local: event.target.value })} />
          </label>
          <label>结束时间
            <input style={inputStyle} type="time" required value={form.end_local} onChange={event => setForm({ ...form, end_local: event.target.value })} />
          </label>
        </div>
        <small>北京时间。起止相同表示全天。结束早于开始表示跨午夜。</small>
        <label><input type="checkbox" checked={form.paused} onChange={event => setForm({ ...form, paused: event.target.checked })} /> 暂停新增发送</label>
        <div><button type="submit" disabled={saving}>{saving ? '保存中…' : '保存触达设置'}</button></div>
      </form>
      {savedNow && <p role="status">已保存。下一次运行使用版本 {saved.revision}。</p>}
    </>}
    {!loading && <button type="button" disabled={saving} onClick={() => void load()} style={{ marginTop: 12 }}>重新读取触达设置</button>}
  </section>;
}
