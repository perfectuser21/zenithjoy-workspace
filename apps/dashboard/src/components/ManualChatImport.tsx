import { useEffect, useMemo, useRef, useState } from 'react';

interface EvidenceItem {
  text: string;
  evidence: string;
  speaker: string | null;
  occurred_at: string | null;
}
interface Analysis {
  summary: string;
  needs: EvidenceItem[];
  quotes: EvidenceItem[];
  commitments: EvidenceItem[];
  next_actions: EvidenceItem[];
  uncertainties: string[];
}
interface Preview {
  id: string;
  version: string | number;
  expires_at: string;
  raw_text: string;
  source_type: 'individual' | 'group';
  channel_name: string;
  source_account: string | null;
  analysis: Analysis;
}
interface HistoryRecord {
  id: string;
  customer_id: string;
  source_type: 'individual' | 'group';
  channel_name: string;
  source_account: string | null;
  raw_text?: string;
  analysis?: Analysis;
  summary?: string;
  created_at: string;
  created_by: string;
}
interface Props {
  customerId?: string | null;
  csWechatId: string;
  customerName: string;
}
interface CommitPayload {
  customer_id: string;
  cs_wechat_id: string;
  preview_id: string;
  preview_version: string | number;
  request_id: string;
  confirmed_result: Analysis;
}
type Recovery = 'unknown' | 'absent' | null;
const API = '/api/crm/manual-history';
const MAX_BYTES = 32 * 1024;
const sections = [
  ['needs', '需求'], ['quotes', '报价'], ['commitments', '承诺'], ['next_actions', '待跟进事项'],
] as const;
const inputStyle = { width: '100%', boxSizing: 'border-box' as const, background: '#111520',
  border: '1px solid #454b60', borderRadius: 6, padding: '8px 10px', color: '#eef0f6', font: 'inherit' };
const buttonStyle = { border: '1px solid #626b83', borderRadius: 6, padding: '7px 12px',
  background: '#242b3e', color: '#eef0f6', cursor: 'pointer', font: 'inherit' };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, url.endsWith('/preview') ? 60_000 : 20_000);
  try {
    const result = await fetch(url, { ...init, credentials: 'include', signal: controller.signal });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) {
      const message = result.status === 401 ? '登录已失效，请重新登录'
        : result.status === 403 ? '当前账号没有此客户的补录权限'
          : data.error?.message || (typeof data.error === 'string' ? data.error : '操作失败，请稍后重试');
      throw new ApiError(result.status, message);
    }
    return data as T;
  } catch (e) {
    if (timedOut) throw new Error('请求超时，请保留当前输入后重试');
    throw e;
  } finally { clearTimeout(timer); }
}
function post<T>(path: string, data: unknown): Promise<T> {
  return jsonRequest<T>(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('无法读取文件'));
    reader.onerror = () => reject(new Error('无法读取文件，请重试'));
    reader.readAsArrayBuffer(file);
  });
}
function materialError(value: string): string | null {
  if (!value.trim()) return '请粘贴聊天文字或上传 TXT';
  if (new TextEncoder().encode(value).byteLength > MAX_BYTES) return '单份内容超过 32 KiB，请分批补录';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(value)) return '内容含无法读取的字符，请使用 UTF-8 纯文本';
  return null;
}
function message(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试'; }

function AnalysisSections({ analysis, onChange, disabled = false }: {
  analysis: Analysis;
  onChange?: (value: Analysis) => void;
  disabled?: boolean;
}) {
  return (
    <div data-testid={onChange ? 'crm-manual-history-editable-analysis' : 'crm-manual-history-readonly-analysis'}>
      {sections.map(([key, title]) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
          {!analysis[key]?.length && <span style={{ color: '#aeb4c6' }}>没有可确认的信息</span>}
          {(analysis[key] ?? []).map((item, i) => (
            <div key={i} style={{ paddingBottom: 10 }}>
              {onChange ? <label>{title} {i + 1}
                <textarea aria-label={`${title} ${i + 1}`} style={inputStyle} disabled={disabled} rows={2} value={item.text}
                  onChange={e => onChange({ ...analysis, [key]: analysis[key].map((row, j) => j === i ? { ...row, text: e.target.value } : row) })} />
              </label> : <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{item.text}</p>}
              <blockquote style={{ margin: '6px 0', paddingLeft: 10, borderLeft: '2px solid #626b83', whiteSpace: 'pre-wrap' }}>{item.evidence}</blockquote>
              <small>发言人：{item.speaker || '未确认'} · 时间：{item.occurred_at || '未确认'}</small>
            </div>
          ))}
        </div>
      ))}
      <div><h4 style={{ margin: '0 0 6px' }}>待确认信息</h4>
        {analysis.uncertainties?.length ? <ul>{analysis.uncertainties.map((value, i) => <li key={i}>{value}</li>)}</ul> : <span>无额外待确认信息</span>}
      </div>
    </div>
  );
}

/** 手动历史材料与微信实时消息独立；任何正式保存都需要明确确认。 */
export default function ManualChatImport({ customerId, csWechatId, customerName }: Props) {
  const enabled = Boolean(customerId && csWechatId);
  // A -> B -> A must create three different scopes, even though the last pair
  // has the same customer/account strings as the first pair.
  const scopeEpoch = useMemo(() => Symbol('manual-history-scope'), [customerId, csWechatId]);
  const scopeRef = useRef<symbol | null>(scopeEpoch);
  scopeRef.current = scopeEpoch;
  const revision = useRef(0);
  const requestRef = useRef<CommitPayload | null>(null);
  const commitBusy = useRef(false);
  const previewBusy = useRef(false);
  const activePreview = useRef<symbol | null>(null);
  const activeCommit = useRef<symbol | null>(null);
  const activeLookup = useRef<symbol | null>(null);
  const activeDetail = useRef<symbol | null>(null);
  const activeRecovery = useRef<symbol | null>(null);
  const recoveryBusy = useRef(false);
  const historyRevision = useRef(0);
  const uploadRevision = useRef(0);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sourceType, setSourceType] = useState<'individual' | 'group'>('individual');
  const [channel, setChannel] = useState(customerName);
  const [sourceAccount, setSourceAccount] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState<Recovery>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [listError, setListError] = useState('');
  const [expanded, setExpanded] = useState<HistoryRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const query = (targetId = customerId ?? '', targetCs = csWechatId) =>
    new URLSearchParams({ customer_id: targetId, cs_wechat_id: targetCs }).toString();

  async function loadHistory(expectedScope = scopeEpoch) {
    if (!enabled) return;
    const currentHistory = ++historyRevision.current;
    try {
      const result = await jsonRequest<{ records: HistoryRecord[] }>(`${API}/?${query()}`);
      if (scopeRef.current === expectedScope && currentHistory === historyRevision.current) { setRecords(result.records); setListError(''); }
    } catch (e) { if (scopeRef.current === expectedScope && currentHistory === historyRevision.current) setListError(message(e)); }
  }

  useEffect(() => {
    scopeRef.current = scopeEpoch;
    revision.current += 1;
    uploadRevision.current += 1;
    requestRef.current = null;
    commitBusy.current = false;
    previewBusy.current = false;
    activePreview.current = null;
    activeCommit.current = null; activeLookup.current = null;
    activeDetail.current = null; activeRecovery.current = null; recoveryBusy.current = false;
    historyRevision.current += 1;
    setOpen(false); setText(''); setChannel(customerName); setSourceAccount('');
    setSourceType('individual'); setPreview(null); setAnalysis(null); setRecovery(null);
    setError(''); setSuccess(''); setRecords([]); setExpanded(null); setListError('');
    setLoadingPreview(false); setSaving(false); setDetailLoading(false);
    void loadHistory(scopeEpoch);
    return () => { if (scopeRef.current === scopeEpoch) scopeRef.current = null; };
    // Scope changes, rather than display-name updates, reset an unfinished material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, csWechatId, scopeEpoch]);

  function changed() {
    revision.current += 1;
    setPreview(null); setAnalysis(null); requestRef.current = null;
    setError(''); setSuccess('');
  }

  async function upload(file?: File) {
    if (!file) return;
    const currentUpload = ++uploadRevision.current;
    const expectedScope = scopeEpoch;
    if (file.size > MAX_BYTES) { setError('文件超过 32 KiB，请分批补录'); return; }
    if (!/\.txt$/i.test(file.name)) { setError('请选择 UTF-8 编码的 .txt 文件'); return; }
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await readFileBytes(file));
      const validation = materialError(value);
      if (validation) throw new Error(validation);
      if (scopeRef.current !== expectedScope || currentUpload !== uploadRevision.current) return;
      changed(); setText(value);
    } catch (e) {
      if (scopeRef.current === expectedScope && currentUpload === uploadRevision.current) {
        setError(e instanceof TypeError ? '文件不是有效的 UTF-8 纯文本，原有内容已保留' : message(e));
      }
    }
  }

  async function generate() {
    if (!enabled || previewBusy.current || saving || recovery) return;
    const validation = materialError(text);
    if (validation || !channel.trim()) { setError(validation ?? '请填写会话名称'); return; }
    setError(''); setSuccess(''); setPreview(null); setAnalysis(null);
    const currentRevision = revision.current;
    const expectedScope = scopeEpoch;
    const operation = Symbol('preview');
    activePreview.current = operation;
    previewBusy.current = true; setLoadingPreview(true);
    try {
      const result = await post<{ preview: Preview }>('/preview', {
        customer_id: customerId, cs_wechat_id: csWechatId, source_type: sourceType,
        channel_name: channel.trim(), text, source_account: sourceAccount.trim() || null,
      });
      if (scopeRef.current === expectedScope && revision.current === currentRevision) {
        setPreview(result.preview); setAnalysis(structuredClone(result.preview.analysis));
      }
    } catch (e) {
      if (scopeRef.current === expectedScope && revision.current === currentRevision) setError(message(e));
    } finally {
      if (scopeRef.current === expectedScope && activePreview.current === operation) {
        activePreview.current = null; previewBusy.current = false; setLoadingPreview(false);
      }
    }
  }

  function saved(record: HistoryRecord, duplicate = false) {
    requestRef.current = null; setRecovery(null); setError('');
    setSuccess(duplicate ? '保存成功，这份材料已补录，已返回原记录。' : '保存成功，已补入客户历史。');
    setPreview(null); setAnalysis(null); setOpen(false);
    setRecords(old => [record, ...old.filter(row => row.id !== record.id)]);
    void loadHistory();
  }

  async function lookup(allowRetry: boolean, payload = requestRef.current, expectedScope = scopeEpoch) {
    if (!payload) return;
    const operation = Symbol('lookup-save-result');
    activeLookup.current = operation;
    const current = () => scopeRef.current === expectedScope && activeLookup.current === operation && requestRef.current === payload;
    try {
      const result = await jsonRequest<{ record: HistoryRecord }>(`${API}/requests/${encodeURIComponent(payload.request_id)}?${query(payload.customer_id, payload.cs_wechat_id)}`);
      if (current()) saved(result.record);
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 404) {
        setRecovery(allowRetry ? 'absent' : 'unknown');
        setError(allowRetry ? '暂未查到保存回执，可使用原请求重试保存。' : '保存结果尚未确认，请先核对保存结果。');
      } else { setRecovery('unknown'); setError(`保存结果尚未确认：${message(e)}`); }
    }
  }

  async function recover() {
    if (recoveryBusy.current || commitBusy.current) return;
    const payload = requestRef.current;
    if (!payload) return;
    const expectedScope = scopeEpoch;
    const operation = Symbol('recover-save-result');
    activeRecovery.current = operation;
    recoveryBusy.current = true; setSaving(true);
    try { await lookup(true, payload, expectedScope); }
    finally {
      if (scopeRef.current === expectedScope && activeRecovery.current === operation) {
        activeRecovery.current = null; recoveryBusy.current = false; setSaving(false);
      }
    }
  }

  async function confirm(retry = false) {
    if (commitBusy.current || !customerId) return;
    if (!retry && (!preview || !analysis || recovery)) return;
    if (!retry && preview && Date.now() >= new Date(preview.expires_at).getTime()) {
      setPreview(null); setAnalysis(null); setError('预览已过期，请重新整理并预览'); return;
    }
    const payload = retry ? requestRef.current : {
      customer_id: customerId, cs_wechat_id: csWechatId,
      preview_id: preview!.id, preview_version: preview!.version,
      request_id: crypto.randomUUID(), confirmed_result: structuredClone(analysis!),
    };
    if (!payload) return;
    requestRef.current = payload;
    const expectedScope = scopeEpoch;
    const operation = Symbol('commit-material');
    activeCommit.current = operation;
    const current = () => scopeRef.current === expectedScope && activeCommit.current === operation;
    commitBusy.current = true; setSaving(true); setError('');
    try {
      const result = await post<{ record: HistoryRecord; duplicate: boolean }>('/commit', payload);
      if (current()) saved(result.record, result.duplicate);
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status < 500) {
        requestRef.current = null; setRecovery(null);
        if (e.status === 409) { setPreview(null); setAnalysis(null); setError('预览已失效或材料发生冲突，请重新整理并预览'); }
        else setError(message(e));
      } else { setRecovery('unknown'); await lookup(false, payload, expectedScope); }
    } finally {
      if (current()) { activeCommit.current = null; commitBusy.current = false; setSaving(false); }
    }
  }

  async function showRecord(id: string) {
    const expectedScope = scopeEpoch;
    const operation = Symbol('read-material');
    activeDetail.current = operation;
    const current = () => scopeRef.current === expectedScope && activeDetail.current === operation;
    setDetailLoading(true); setListError('');
    try {
      const result = await jsonRequest<{ record: HistoryRecord }>(`${API}/${encodeURIComponent(id)}?${query()}`);
      if (current()) setExpanded(result.record);
    } catch (e) { if (current()) setListError(message(e)); }
    finally { if (current()) { activeDetail.current = null; setDetailLoading(false); } }
  }

  const locked = saving || Boolean(recovery);
  return (
    <section data-testid="crm-manual-history" aria-label="历史聊天补录"
      style={{ margin: '20px 0', padding: 18, border: '1px solid #454b60', borderRadius: 10, background: '#191c27' }}>
      <h2 style={{ fontSize: 17, marginTop: 0 }}>历史聊天补录</h2>
      <p style={{ color: '#aeb4c6', fontSize: 13 }}>粘贴文字或上传 TXT，核对后补入此客户档案。只保存本次提供的材料，不代表完整微信历史。</p>
      <button style={buttonStyle} type="button" disabled={!enabled || locked} onClick={() => setOpen(value => !value)}>
        补录聊天记录
      </button>
      {!customerId && <p>请先将客户加入名册，再补录聊天记录。</p>}
      {customerId && !csWechatId && <p>请先选择此客户所属的微信账号。</p>}
      {success && <p role="status" style={{ color: '#86efac' }}>{success}</p>}
      {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
      {open && enabled && (
        <div data-testid="crm-manual-history-form" style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <p style={{ margin: 0 }}>关联客户：{customerName}</p>
          <label>会话类型
            <select aria-label="会话类型" style={inputStyle} disabled={locked} value={sourceType}
              onChange={e => { changed(); setSourceType(e.target.value as 'individual' | 'group'); }}>
              <option value="individual">个人聊天</option><option value="group">群聊</option>
            </select>
          </label>
          <label>会话名称
            <input aria-label="会话名称" style={inputStyle} maxLength={256} disabled={locked} value={channel}
              onChange={e => { changed(); setChannel(e.target.value); }} />
          </label>
          <label>来源微信账号（可选）
            <input aria-label="来源微信账号（可选）" style={inputStyle} maxLength={256} disabled={locked} value={sourceAccount}
              placeholder="不知道可以留空" onChange={e => { changed(); setSourceAccount(e.target.value); }} />
          </label>
          <label>上传 TXT
            <input aria-label="上传 TXT" type="file" accept=".txt,text/plain" disabled={locked}
              onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <label>聊天记录
            <textarea aria-label="聊天记录" data-testid="crm-manual-history-text" style={inputStyle} rows={8}
              disabled={locked} value={text} placeholder="粘贴聊天原文，尽量保留发言人和日期；没有的信息可以留空。"
              onChange={e => { uploadRevision.current += 1; changed(); setText(e.target.value); }} />
          </label>
          <span style={{ color: '#aeb4c6', fontSize: 12 }}>每次最多 32 KiB 纯文本。图片、语音等内容不会自动转换。</span>
          <div><button style={buttonStyle} type="button" disabled={loadingPreview || locked} onClick={() => { void generate(); }}>
            {loadingPreview ? '正在整理…' : '整理并预览'}
          </button></div>
          {preview && analysis && (
            <div data-testid="crm-manual-history-preview" style={{ display: 'grid', gap: 14, borderTop: '1px solid #454b60', paddingTop: 16 }}>
              <h3 style={{ margin: 0 }}>核对整理结果</h3>
              <label>整理摘要
                <textarea aria-label="整理摘要" rows={3} style={inputStyle} disabled={locked} value={analysis.summary}
                  onChange={e => setAnalysis({ ...analysis, summary: e.target.value })} />
              </label>
              <AnalysisSections analysis={analysis} onChange={setAnalysis} disabled={locked} />
              <p style={{ fontSize: 12, color: '#aeb4c6' }}>请核对原文依据。群成员的发言不会自动认定为客户的承诺，未确认的信息会保留说明。</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!recovery && <button style={buttonStyle} type="button" disabled={saving} onClick={() => { void confirm(); }}>{saving ? '保存中…' : '确认保存'}</button>}
                {!recovery && <button style={buttonStyle} type="button" disabled={saving} onClick={() => { changed(); }}>取消预览</button>}
              </div>
            </div>
          )}
          {recovery && (
            <div><p>正在核对这次保存结果；核对完成前请保留当前材料。</p>
              <button style={buttonStyle} type="button" disabled={saving} onClick={() => { void recover(); }}>核对保存结果</button>
              {recovery === 'absent' && <button style={{ ...buttonStyle, marginLeft: 8 }} type="button" disabled={saving} onClick={() => { void confirm(true); }}>重试保存</button>}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 15 }}>已补录材料</h3>
        {listError && <p role="alert">{listError}</p>}
        {!records.length && !listError && <p style={{ color: '#aeb4c6' }}>还没有补录材料。</p>}
        {records.map(row => <div key={row.id} style={{ padding: '10px 0', borderTop: '1px solid #454b60' }}>
          <div>{row.source_type === 'group' ? '群聊' : '个人聊天'} · {row.channel_name}</div>
          <p>{row.summary || row.analysis?.summary || '历史聊天材料'}</p>
          <button style={buttonStyle} type="button" disabled={detailLoading} onClick={() => { void showRecord(row.id); }}>查看原文 · {row.channel_name}</button>
        </div>)}
        {expanded && <div data-testid="crm-manual-history-record" style={{ padding: 12, background: '#111520', borderRadius: 6 }}>
          <h4>{expanded.channel_name} · 手动补录</h4>
          <p>来源账号：{expanded.source_account || '未提供'} · 提交人：{expanded.created_by}</p>
          <p>补录时间：{new Date(expanded.created_at).toLocaleString('zh-CN')}</p>
          <p>{expanded.analysis?.summary}</p>
          {expanded.analysis && <AnalysisSections analysis={expanded.analysis} />}
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{expanded.raw_text}</pre>
          <button style={buttonStyle} type="button" onClick={() => setExpanded(null)}>收起原文</button>
        </div>}
      </div>
    </section>
  );
}
