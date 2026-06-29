import { useCallback, useEffect, useRef, useState } from 'react';
import { getCompanyProfile, updateCompanyProfile, type CompanyProfile } from '../api/company-profile.api';

const INDUSTRIES = ['餐饮', '零售', '电商', '教育', '医疗', '科技', '金融', '房地产', '制造', '其他'];

const EMPTY: CompanyProfile = {
  company_name: '', city: '', industry: '', description: '',
  products: [], key_advantages: [], customer_problem: '',
  customer_portrait: '', qa_list: [],
};

const TABS = ['基础信息', '产品与价值', '目标客群'] as const;
type TabKey = (typeof TABS)[number];

export default function CompanyProfilePage() {
  const [form, setForm] = useState<CompanyProfile>({ ...EMPTY });
  const formRef = useRef<CompanyProfile>({ ...EMPTY });
  const [activeTab, setActiveTab] = useState<TabKey>('基础信息');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);

  useEffect(() => {
    getCompanyProfile().then(data => {
      formRef.current = data;
      setForm(data);
    }).catch(() => {});
  }, []);

  const showToast = (msg: string, ok = true) => {
    setToast(msg);
    setToastOk(ok);
    setTimeout(() => setToast(''), 3000);
  };

  const handleBlur = useCallback(async () => {
    const current = formRef.current;
    if (!current.company_name) return;
    setSaving(true);
    try {
      await updateCompanyProfile(current);
      showToast('已保存 ✓');
    } catch {
      showToast('保存失败，请重试', false);
    } finally {
      setSaving(false);
    }
  }, []);

  const setField = <K extends keyof CompanyProfile>(key: K, val: CompanyProfile[K]) => {
    formRef.current = { ...formRef.current, [key]: val };
    setForm({ ...formRef.current });
  };

  const setListItem = (key: 'products' | 'key_advantages', idx: number, val: string) => {
    const arr = [...(formRef.current[key] as string[])];
    arr[idx] = val;
    formRef.current = { ...formRef.current, [key]: arr };
    setForm({ ...formRef.current });
  };

  const addListItem = (key: 'products' | 'key_advantages') => {
    formRef.current = { ...formRef.current, [key]: [...(formRef.current[key] as string[]), ''] };
    setForm({ ...formRef.current });
  };

  const removeListItem = (key: 'products' | 'key_advantages', idx: number) => {
    const arr = [...(formRef.current[key] as string[])];
    arr.splice(idx, 1);
    formRef.current = { ...formRef.current, [key]: arr };
    setForm({ ...formRef.current });
  };

  const setQaItem = (idx: number, field: 'q' | 'a', val: string) => {
    const qa = [...formRef.current.qa_list];
    qa[idx] = { ...qa[idx], [field]: val };
    formRef.current = { ...formRef.current, qa_list: qa };
    setForm({ ...formRef.current });
  };

  const addQa = () => {
    formRef.current = { ...formRef.current, qa_list: [...formRef.current.qa_list, { q: '', a: '' }] };
    setForm({ ...formRef.current });
  };

  const removeQa = (idx: number) => {
    const qa = [...formRef.current.qa_list];
    qa.splice(idx, 1);
    formRef.current = { ...formRef.current, qa_list: qa };
    setForm({ ...formRef.current });
  };

  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 };
  const labelSpanStyle = { display: 'block', marginBottom: 4, fontSize: 13, color: '#555' } as const;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>公司信息</h1>

      {toast && (
        <div data-testid="save-toast" style={{
          position: 'fixed', top: 20, right: 20,
          background: toastOk ? '#333' : '#e53e3e',
          color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 9999,
        }}>{toast}</div>
      )}

      {/* Tab bar */}
      <div role="tablist" style={{ display: 'flex', borderBottom: '2px solid #eee', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none',
              borderBottom: activeTab === tab ? '2px solid #1a73e8' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#1a73e8' : '#555',
            }}
          >{tab}</button>
        ))}
      </div>

      {/* Tab 1 — 基础信息 */}
      {activeTab === '基础信息' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            <span style={labelSpanStyle}>公司名 *</span>
            <input data-testid="company_name" value={form.company_name}
              onChange={e => setField('company_name', e.target.value)}
              onBlur={() => void handleBlur()}
              style={inputStyle} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <span style={labelSpanStyle}>所在城市</span>
              <input data-testid="city" value={form.city}
                onChange={e => setField('city', e.target.value)}
                onBlur={() => void handleBlur()}
                style={inputStyle} />
            </label>
            <label>
              <span style={labelSpanStyle}>行业</span>
              <select data-testid="industry" value={form.industry}
                onChange={e => setField('industry', e.target.value)}
                onBlur={() => void handleBlur()}
                style={inputStyle}>
                <option value="">请选择</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span style={labelSpanStyle}>一句话介绍</span>
            <input data-testid="description" value={form.description}
              onChange={e => setField('description', e.target.value)}
              onBlur={() => void handleBlur()}
              style={inputStyle} />
          </label>
        </div>
      )}

      {/* Tab 2 — 产品与价值 */}
      {activeTab === '产品与价值' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelSpanStyle}>主营产品</span>
            {(form.products as string[]).map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={p}
                  onChange={e => setListItem('products', i, e.target.value)}
                  onBlur={() => void handleBlur()}
                  style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }} />
                <button onClick={() => removeListItem('products', i)}
                  style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }}>删除</button>
              </div>
            ))}
            <button onClick={() => addListItem('products')}
              style={{ padding: '6px 16px', border: '1px dashed #aaa', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}>+ 添加产品</button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelSpanStyle}>核心卖点（1-3 条）</span>
            {(form.key_advantages as string[]).map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={a}
                  onChange={e => setListItem('key_advantages', i, e.target.value)}
                  onBlur={() => void handleBlur()}
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
            <span style={labelSpanStyle}>解决客户问题</span>
            <textarea value={form.customer_problem}
              onChange={e => setField('customer_problem', e.target.value)}
              onBlur={() => void handleBlur()}
              rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, resize: 'vertical' }} />
          </label>
        </div>
      )}

      {/* Tab 3 — 目标客群 */}
      {activeTab === '目标客群' && (
        <div>
          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={labelSpanStyle}>客户画像描述</span>
            <textarea value={form.customer_portrait}
              onChange={e => setField('customer_portrait', e.target.value)}
              onBlur={() => void handleBlur()}
              rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, resize: 'vertical' }} />
          </label>
          <div>
            <span style={labelSpanStyle}>客户常见 Q&A</span>
            {form.qa_list.map((qa, i) => (
              <div key={i} style={{ marginBottom: 12, padding: 12, border: '1px solid #eee', borderRadius: 6 }}>
                <input placeholder="问题" value={qa.q}
                  onChange={e => setQaItem(i, 'q', e.target.value)}
                  onBlur={() => void handleBlur()}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 8 }} />
                <input placeholder="回答" value={qa.a}
                  onChange={e => setQaItem(i, 'a', e.target.value)}
                  onBlur={() => void handleBlur()}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 8 }} />
                <button onClick={() => removeQa(i)}
                  style={{ padding: '4px 12px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}>删除</button>
              </div>
            ))}
            <button onClick={addQa}
              style={{ padding: '6px 16px', border: '1px dashed #aaa', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}>+ 添加 Q&A</button>
          </div>
        </div>
      )}

      {saving && <div style={{ marginTop: 16, fontSize: 13, color: '#888' }}>保存中...</div>}
    </div>
  );
}
