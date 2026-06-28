import { useCallback, useEffect, useState } from 'react';
import { getCompanyProfile, updateCompanyProfile, type CompanyProfile } from '../api/company-profile.api';

const INDUSTRIES = ['餐饮', '零售', '电商', '教育', '医疗', '科技', '金融', '房地产', '制造', '其他'];

const EMPTY: CompanyProfile = {
  company_name: '', city: '', industry: '', description: '',
  products: [], key_advantages: [], customer_problem: '',
  customer_portrait: '', qa_list: [],
};

export default function CompanyProfilePage() {
  const [form, setForm] = useState<CompanyProfile>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    getCompanyProfile().then(setForm).catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await updateCompanyProfile(form);
      showToast('已保存');
    } catch {
      showToast('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [form]);

  const setField = <K extends keyof CompanyProfile>(key: K, val: CompanyProfile[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const setListItem = (key: 'products' | 'key_advantages', idx: number, val: string) =>
    setForm(f => {
      const arr = [...(f[key] as string[])];
      arr[idx] = val;
      return { ...f, [key]: arr };
    });

  const addListItem = (key: 'products' | 'key_advantages') =>
    setForm(f => ({ ...f, [key]: [...(f[key] as string[]), ''] }));

  const removeListItem = (key: 'products' | 'key_advantages', idx: number) =>
    setForm(f => {
      const arr = [...(f[key] as string[])];
      arr.splice(idx, 1);
      return { ...f, [key]: arr };
    });

  const setQaItem = (idx: number, field: 'q' | 'a', val: string) =>
    setForm(f => {
      const qa = [...f.qa_list];
      qa[idx] = { ...qa[idx], [field]: val };
      return { ...f, qa_list: qa };
    });

  const addQa = () => setForm(f => ({ ...f, qa_list: [...f.qa_list, { q: '', a: '' }] }));
  const removeQa = (idx: number) => setForm(f => {
    const qa = [...f.qa_list];
    qa.splice(idx, 1);
    return { ...f, qa_list: qa };
  });

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>公司信息</h1>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, background: '#333', color: '#fff',
          padding: '10px 20px', borderRadius: 8, zIndex: 9999
        }}>{toast}</div>
      )}

      {/* Section 1 — 基础信息 */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#333' }}>基础信息</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>公司名 *</span>
            <input value={form.company_name} onChange={e => setField('company_name', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>所在城市</span>
              <input value={form.city} onChange={e => setField('city', e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
            </label>
            <label>
              <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>行业</span>
              <select value={form.industry} onChange={e => setField('industry', e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>
                <option value="">请选择</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>一句话介绍</span>
            <input value={form.description} onChange={e => setField('description', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
          </label>
        </div>
      </section>

      {/* Section 2 — 产品卖点 */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#333' }}>产品卖点</h2>
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#555' }}>主营产品</span>
          {(form.products as string[]).map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={p} onChange={e => setListItem('products', i, e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
              <button onClick={() => removeListItem('products', i)}
                style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }}>删除</button>
            </div>
          ))}
          <button onClick={() => addListItem('products')}
            style={{ padding: '6px 16px', border: '1px dashed #aaa', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}>+ 添加产品</button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#555' }}>核心卖点（1-3 条）</span>
          {(form.key_advantages as string[]).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={a} onChange={e => setListItem('key_advantages', i, e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
              <button onClick={() => removeListItem('key_advantages', i)}
                style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }}>删除</button>
            </div>
          ))}
          {(form.key_advantages as string[]).length < 3 && (
            <button onClick={() => addListItem('key_advantages')}
              style={{ padding: '6px 16px', border: '1px dashed #aaa', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}>+ 添加卖点</button>
          )}
        </div>
        <label>
          <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>解决客户问题</span>
          <textarea value={form.customer_problem} onChange={e => setField('customer_problem', e.target.value)}
            rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, resize: 'vertical' }} />
        </label>
      </section>

      {/* Section 3 — 客户画像 */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#333' }}>客户画像</h2>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#555' }}>客户画像描述</span>
          <textarea value={form.customer_portrait} onChange={e => setField('customer_portrait', e.target.value)}
            rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, resize: 'vertical' }} />
        </label>
        <div>
          <span style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#555' }}>客户常见 Q&A</span>
          {form.qa_list.map((qa, i) => (
            <div key={i} style={{ marginBottom: 12, padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
              <input placeholder="问题" value={qa.q} onChange={e => setQaItem(i, 'q', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 8 }} />
              <input placeholder="回答" value={qa.a} onChange={e => setQaItem(i, 'a', e.target.value)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 8 }} />
              <button onClick={() => removeQa(i)}
                style={{ padding: '4px 12px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}>删除</button>
            </div>
          ))}
          <button onClick={addQa}
            style={{ padding: '6px 16px', border: '1px dashed #aaa', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}>+ 添加 Q&A</button>
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving || !form.company_name}
          style={{
            padding: '10px 32px', background: '#1a73e8', color: '#fff',
            border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving || !form.company_name ? 0.6 : 1, fontSize: 15
          }}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
