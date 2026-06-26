/**
 * CustomerListPage — Line04 中台 AI 客户运营台（Glide Data Grid 暗色重做）
 *
 * 路由：/wechat/crm（归进「私域客服」板块；旧 /customers 301 → 此处）
 *
 * 暗色 AI 运营台：Glide Data Grid canvas 视图 + 编辑面板（HTML DOM）。
 *  - Glide canvas：视觉展示（Fraunces 标题 + Hanken Grotesk 正文 + 金色点缀 + 噪点背景）
 *  - 编辑面板（data-testid DOM）：自动选中首行，点 Glide 行切换；意向/身份下拉在此操作
 *
 * **保留所有现有行为（per-operator 契约 2026-06-25）**：
 *  - session fetch credentials:include，不注入超管头
 *  - onboarding 状态条 O1-O5
 *  - 扫好友按钮 + 加客户表单
 *  - PUT /customers/status + PUT /customers/identity
 *  - 点名字导航 /wechat/crm/:contact
 *
 * **意向色阶**（A4=成交金，A5=流失暗红，语义正确）：
 *  A1 新客#7a8092 · A2 沟通中#5b8cc4 · A3 意向#8f7bd6 · A4 成交#e3b169 · A5 流失#c0594d
 *
 * 注意：这个运营台自带暗色 surface，不跟随 dashboard 全局亮暗主题切换。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataEditor, GridCellKind, type GridColumn, type Item, type GridCell } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';

// ──────────────────────────────────────────────────────────────────────────────
// 类型 & 常量
// ──────────────────────────────────────────────────────────────────────────────

function sessionFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include' });
}

type CrmStatus = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';
type CrmIdentity = 'customer' | 'blacklist' | 'internal';

const STATUS_OPTIONS: CrmStatus[] = ['A1', 'A2', 'A3', 'A4', 'A5'];
const STATUS_LABELS: Record<CrmStatus, string> = {
  A1: 'A1 新客',
  A2: 'A2 沟通中',
  A3: 'A3 意向',
  A4: 'A4 成交',
  A5: 'A5 流失',
};
// A4=成交（正向金），A5=流失（负向暗红）
const STATUS_COLORS: Record<CrmStatus, string> = {
  A1: '#7a8092',
  A2: '#5b8cc4',
  A3: '#8f7bd6',
  A4: '#e3b169',
  A5: '#c0594d',
};

const IDENTITY_OPTIONS: CrmIdentity[] = ['customer', 'blacklist', 'internal'];
const IDENTITY_LABELS: Record<CrmIdentity, string> = {
  customer: '客户·接管',
  blacklist: '黑名单',
  internal: '内部人员',
};
const IDENTITY_COLORS: Record<CrmIdentity, string> = {
  customer: '#aeb4c6',
  internal: '#5b8cc4',
  blacklist: '#d4685f',
};

interface CustomerRow {
  name: string;
  contact: string;
  wechat_id: string | null;
  status: CrmStatus;
  last_contact_at: string | null;
  managed: boolean;
  source?: 'message' | 'manual' | 'scan' | null;
  last_message?: string | null;
  add_friend_time?: string | null;
  identity?: CrmIdentity | null;
}

interface CustomerListResponse {
  customers: CustomerRow[];
  total: number;
  cs_wechat_id: string | null;
}

type OnboardingStepState = 'pending' | 'ok' | 'fail';
interface OnboardingState {
  step_o1_online: OnboardingStepState;
  step_o2_scanned: OnboardingStepState;
  scanned_count: number;
  step_o3_roster: OnboardingStepState;
  blacklist_count: number;
  step_o4_realpublish: OnboardingStepState;
  step_o5_replied: OnboardingStepState;
}

const ONBOARDING_STEPS: { key: keyof OnboardingState; label: string; hint: string }[] = [
  { key: 'step_o1_online', label: 'O1 客服机在线', hint: '客服机已上线 / 绑 license' },
  { key: 'step_o2_scanned', label: 'O2 扫到好友', hint: 'agent 扫近期会话联系人上报' },
  { key: 'step_o3_roster', label: 'O3 名册建好', hint: '默认全接管 + 黑名单初始化' },
  { key: 'step_o4_realpublish', label: 'O4 真发已开', hint: '真发开关打开 + pywinauto 可用' },
  { key: 'step_o5_replied', label: 'O5 真回出去', hint: '首条真回出去 + 真送达确认' },
];

// ──────────────────────────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
}

function currentIdentity(row: CustomerRow): CrmIdentity {
  if (row.identity === 'internal') return 'internal';
  if (row.identity === 'blacklist') return 'blacklist';
  if (row.identity === 'customer') return row.managed ? 'customer' : 'blacklist';
  return row.managed ? 'customer' : 'blacklist';
}

// ──────────────────────────────────────────────────────────────────────────────
// Glide 暗色主题
// ──────────────────────────────────────────────────────────────────────────────

const DARK_THEME = {
  accentColor: '#e3b169',
  accentLight: 'rgba(227,177,105,.18)',
  textDark: '#eef0f6',
  textMedium: '#aeb4c6',
  textLight: '#6f7588',
  textBubble: '#eef0f6',
  bgIconHeader: '#aeb4c6',
  fgIconHeader: '#14161f',
  textHeader: '#9aa0b2',
  textHeaderSelected: '#fff',
  bgCell: '#14161f',
  bgCellMedium: '#171a24',
  bgHeader: '#101218',
  bgHeaderHasFocus: '#191c27',
  bgHeaderHovered: '#161924',
  bgBubble: '#222634',
  bgBubbleSelected: '#2d3346',
  bgSearchResult: '#3a3320',
  borderColor: 'rgba(35,39,52,.34)',
  horizontalBorderColor: '#1d212c',
  drilldownBorder: '#2d3242',
  linkColor: '#e3b169',
  cellHorizontalPadding: 14,
  cellVerticalPadding: 12,
  headerFontStyle: '600 12px',
  baseFontStyle: '13px',
  fontFamily: '"Hanken Grotesk","PingFang SC","Microsoft YaHei",sans-serif',
};

// ──────────────────────────────────────────────────────────────────────────────
// Glide 列定义
// ──────────────────────────────────────────────────────────────────────────────

const COLS: GridColumn[] = [
  { title: '姓名', id: 'name', width: 140 },
  { title: '微信号', id: 'wx', width: 160 },
  { title: '意向', id: 'intent', width: 118 },
  { title: '身份', id: 'identity', width: 92 },
  { title: '加微信', id: 'add', width: 116 },
  { title: '最近联系', id: 'last', width: 108 },
  { title: '最后消息', id: 'msg', width: 240 },
];

// ──────────────────────────────────────────────────────────────────────────────
// onboarding 圆点
// ──────────────────────────────────────────────────────────────────────────────

function StepDot({ state }: { state: OnboardingStepState }) {
  const color = state === 'ok' ? '#16a34a' : state === 'fail' ? '#dc2626' : '#4b5563';
  return (
    <span
      data-testid="crm-onboarding-dot"
      data-state={state}
      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 5 }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────────────────────────────────────────

export default function CustomerListPage() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [csWechatId, setCsWechatId] = useState<string>('');
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [authExpired, setAuthExpired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWechatId, setNewWechatId] = useState('');
  const [scanning, setScanning] = useState(false);

  // 搜索 & 过滤状态
  const [searchQ, setSearchQ] = useState('');
  const [intentSel, setIntentSel] = useState<Set<string>>(() => new Set());

  // 编辑面板：自动选中首行（auto-set when rows load，点 Glide 行切换）
  const [editingRow, setEditingRow] = useState<CustomerRow | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await sessionFetch('/api/crm/customers');
      if (res.status === 401) {
        setAuthExpired(true);
        setError('登录已失效，请重新登录');
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error(`加载失败（${res.status}）`);
      const data = (await res.json()) as CustomerListResponse;
      setAuthExpired(false);
      setRows(data.customers ?? []);
      if (data.cs_wechat_id) setCsWechatId(data.cs_wechat_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOnboarding = useCallback(async (wechatId: string) => {
    if (!wechatId) { setOnboarding(null); return; }
    try {
      const res = await sessionFetch(`/api/crm/onboarding/${encodeURIComponent(wechatId)}`);
      if (!res.ok) { setOnboarding(null); return; }
      const data = (await res.json()) as { onboarding?: OnboardingState } | OnboardingState;
      const ob = (data as { onboarding?: OnboardingState }).onboarding ?? (data as OnboardingState);
      setOnboarding(ob && 'step_o1_online' in ob ? ob : null);
    } catch { setOnboarding(null); }
  }, []);

  useEffect(() => { void loadCustomers(); }, [loadCustomers]);
  useEffect(() => { void loadOnboarding(csWechatId); }, [csWechatId, loadOnboarding]);

  // 首行自动选中（rows 变化时更新编辑面板到最新 rows[0]）
  useEffect(() => {
    if (rows.length > 0) setEditingRow(rows[0]);
  }, [rows]);

  const writeJson = useCallback(async (url: string, method: string, body: unknown): Promise<unknown | null> => {
    const res = await sessionFetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 401) { setAuthExpired(true); flash('登录已失效，请重新登录'); return null; }
    if (!res.ok) { flash(`保存失败（${res.status}）`); return null; }
    setAuthExpired(false);
    return res.json();
  }, [flash]);

  const onChangeStatus = useCallback(async (row: CustomerRow, status: CrmStatus) => {
    const out = await writeJson('/api/crm/customers/status', 'PUT', {
      wechat_id: csWechatId, contact: row.contact, status,
    });
    if (!out) return;
    flash('保存成功');
    await loadCustomers();
  }, [csWechatId, writeJson, flash, loadCustomers]);

  const onChangeIdentity = useCallback(async (row: CustomerRow, identity: CrmIdentity) => {
    const out = await writeJson('/api/crm/customers/identity', 'PUT', {
      wechat_id: csWechatId, contact: row.contact, identity,
    });
    if (!out) return;
    flash(identity === 'internal' ? '已标为内部人员（移出客户列表）' : '保存成功');
    await loadCustomers();
  }, [csWechatId, writeJson, flash, loadCustomers]);

  const onAddCustomer = useCallback(async () => {
    const name = newName.trim();
    if (!name) { flash('请填写客户姓名'); return; }
    const out = await writeJson('/api/crm/customers', 'POST', {
      wechat_id: csWechatId, name, contact: name,
    });
    if (!out) return;
    setNewName(''); setNewWechatId(''); setAdding(false);
    flash('保存成功');
    await loadCustomers();
  }, [newName, csWechatId, writeJson, flash, loadCustomers]);

  const onForceScan = useCallback(async () => {
    if (!csWechatId) { flash('客服机还没就绪，请稍候再试'); return; }
    setScanning(true);
    try {
      const out = (await writeJson('/api/crm/friend-scan/trigger', 'POST', { cs_wechat_id: csWechatId })) as { ok?: boolean } | null;
      if (!out) return;
      flash('已通知客服机，扫到的好友会自动出现（约几十秒）');
    } finally { setScanning(false); }
  }, [csWechatId, writeJson, flash]);

  const openProfile = useCallback((row: CustomerRow) => {
    const params = new URLSearchParams();
    if (csWechatId) params.set('cs', csWechatId);
    if (row.name && row.name !== row.contact) params.set('name', row.name);
    const qs = params.toString();
    navigate(`/wechat/crm/${encodeURIComponent(row.contact)}${qs ? `?${qs}` : ''}`);
  }, [csWechatId, navigate]);

  // 意向 chip 切换
  const toggleIntent = useCallback((k: string) => {
    setIntentSel(prev => { const n = new Set(prev); if (n.has(k)) { n.delete(k); } else { n.add(k); } return n; });
  }, []);

  // 客户端过滤
  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (intentSel.size > 0 && !intentSel.has(row.status)) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        const name = (row.name || row.contact).toLowerCase();
        const wx = (row.wechat_id || '').toLowerCase();
        if (!name.includes(q) && !wx.includes(q)) return false;
      }
      return true;
    });
  }, [rows, searchQ, intentSel]);

  // Glide getCellContent
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, row] = cell;
    const r = filteredRows[row];
    if (!r) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };

    switch (col) {
      case 0:
        return { kind: GridCellKind.Text, data: r.name, displayData: r.name, allowOverlay: false,
          themeOverride: { textDark: '#ffffff', baseFontStyle: '600 13.5px' } };
      case 1:
        return { kind: GridCellKind.Text, data: r.wechat_id ?? '—', displayData: r.wechat_id ?? '—',
          allowOverlay: false, themeOverride: { textDark: '#8b91a4', baseFontStyle: '12px' } };
      case 2: {
        const clr = STATUS_COLORS[r.status] ?? '#7a8092';
        return { kind: GridCellKind.Text, data: r.status,
          displayData: '● ' + STATUS_LABELS[r.status], allowOverlay: false,
          themeOverride: { textDark: clr, baseFontStyle: '600 13px' } };
      }
      case 3: {
        const id = currentIdentity(r);
        return { kind: GridCellKind.Text, data: id, displayData: IDENTITY_LABELS[id],
          allowOverlay: false, themeOverride: { textDark: IDENTITY_COLORS[id] ?? '#aeb4c6' } };
      }
      case 4:
        return { kind: GridCellKind.Text, data: fmtDate(r.add_friend_time ?? null),
          displayData: fmtDate(r.add_friend_time ?? null), allowOverlay: false,
          themeOverride: { textDark: '#8b91a4', baseFontStyle: '12px' } };
      case 5:
        return { kind: GridCellKind.Text, data: fmtDate(r.last_contact_at),
          displayData: fmtDate(r.last_contact_at), allowOverlay: false,
          themeOverride: { textDark: '#aeb4c6', baseFontStyle: '12px' } };
      case 6: {
        const hot = r.status === 'A3' || r.status === 'A4';
        return { kind: GridCellKind.Text, data: r.last_message ?? '—',
          displayData: r.last_message ?? '—', allowOverlay: false,
          themeOverride: { textDark: hot ? '#e3b169' : '#6f7588', baseFontStyle: '12px' } };
      }
      default:
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
    }
  }, [filteredRows]);

  // 点 Glide 行 → 选中到编辑面板；点姓名列 → 进主页
  const onCellClicked = useCallback((cell: Item) => {
    const [col, row] = cell;
    const r = filteredRows[row];
    if (!r) return;
    if (col === 0) {
      openProfile(r);
    } else {
      setEditingRow(r);
    }
  }, [filteredRows, openProfile]);

  // ─── 今日 AI 规划统计（仅 raw rows，非 filteredRows）─────────────────────────
  const statsToday = rows.filter(r => currentIdentity(r) !== 'internal' && ['A1','A2','A3'].includes(r.status)).length;
  const statsHighIntent = rows.filter(r => r.status === 'A3').length;
  const statsNoContact = rows.filter(r => {
    if (!r.last_contact_at) return true;
    return Date.now() - new Date(r.last_contact_at).getTime() > 3 * 24 * 3600 * 1000;
  }).length;

  // ──────────────────────────────────────────────────────────────────────────────
  // 渲染
  // ──────────────────────────────────────────────────────────────────────────────

  // 全局字体注入（Fraunces + Hanken Grotesk）
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,500&family=Hanken+Grotesk:wght@400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  const S = {
    // 页面容器：暗色全屏
    page: {
      minHeight: '100vh',
      background: `
        radial-gradient(1200px 600px at 85% -10%, rgba(227,177,105,.09), transparent 60%),
        radial-gradient(900px 500px at 5% 110%, rgba(95,140,196,.07), transparent 55%),
        #0c0d11
      `,
      color: '#eef0f6',
      fontFamily: '"Hanken Grotesk","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
      WebkitFontSmoothing: 'antialiased' as const,
      position: 'relative' as const,
    },
    wrap: { maxWidth: 1280, margin: '0 auto', padding: '28px 28px 40px' },

    // 顶部左侧：品牌 + 标题
    brandRow: { display: 'flex', alignItems: 'center', gap: 8, color: '#6f7588', fontSize: 12,
      letterSpacing: '.18em', textTransform: 'uppercase' as const, marginBottom: 8 },
    brandDot: { width: 7, height: 7, borderRadius: '50%', background: '#e3b169',
      boxShadow: '0 0 12px #e3b169' },
    title: { fontFamily: '"Fraunces",serif', fontWeight: 600, fontSize: 36,
      lineHeight: 1.05, margin: 0, letterSpacing: '-.01em' },
    titleEm: { fontStyle: 'italic', color: '#e3b169', fontWeight: 500 },
    sub: { color: '#aeb4c6', fontSize: 13.5, marginTop: 7, lineHeight: 1.5 },

    // 今日 AI 规划卡
    planCard: { minWidth: 280, border: '1px solid #2d3242', borderRadius: 16,
      padding: '14px 18px',
      background: 'linear-gradient(160deg,rgba(227,177,105,.10),rgba(20,22,31,.4))',
      backdropFilter: 'blur(6px)' },
    planTitle: { margin: '0 0 10px', fontSize: 11, letterSpacing: '.15em',
      textTransform: 'uppercase' as const, color: '#caa15f', fontWeight: 700,
      display: 'flex', alignItems: 'center', gap: 7 },
    planNums: { display: 'flex', gap: 20 },
    planNum: {} as React.CSSProperties,
    planNumB: { fontFamily: '"Fraunces",serif', fontSize: 28, fontWeight: 600,
      display: 'block', lineHeight: 1, color: '#eef0f6' },
    planNumSpan: { fontSize: 11, color: '#6f7588', letterSpacing: '.03em' },

    // 工具栏
    bar: { display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0', flexWrap: 'wrap' as const },
    searchWrap: { position: 'relative' as const, flex: '0 0 260px' },
    searchInput: {
      width: '100%', background: '#14161f', border: '1px solid rgba(35,39,52,.8)',
      color: '#eef0f6', padding: '9px 12px 9px 34px', borderRadius: 10,
      fontSize: 13, fontFamily: 'inherit', outline: 'none',
    },
    chips: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
    chip: (on: boolean, color?: string): React.CSSProperties => ({
      border: `1px solid ${on ? (color || '#aeb4c6') : 'rgba(35,39,52,.8)'}`,
      background: on ? 'rgba(255,255,255,.05)' : '#14161f',
      color: on ? (color || '#aeb4c6') : '#aeb4c6',
      padding: '6px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' as const,
      fontWeight: on ? 600 : 400, transition: '.15s',
    }),
    chipDot: (color: string): React.CSSProperties => ({
      width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
    }),
    spacer: { flex: 1 },
    count: { color: '#6f7588', fontSize: 12.5 },
    countB: { color: '#eef0f6', fontWeight: 600 },

    // Glide 容器
    gridFrame: {
      border: '1px solid rgba(35,39,52,.8)', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 30px 80px -30px rgba(0,0,0,.7)', background: '#14161f',
      height: 520,
    },

    // 编辑面板
    editPanel: {
      marginTop: 10, padding: '12px 16px', background: '#191c27',
      border: '1px solid rgba(35,39,52,.6)', borderRadius: 12,
      display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 14,
    },
    editLabel: { fontSize: 11, color: '#6f7588' },
    editSelect: {
      background: '#14161f', border: '1px solid rgba(35,39,52,.8)',
      borderRadius: 7, padding: '5px 9px', fontSize: 13, fontFamily: 'inherit',
      cursor: 'pointer', outline: 'none',
    },

    // onboarding 条
    onboardBar: {
      display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 14,
      margin: '10px 0', padding: '10px 14px', background: '#14161f',
      border: '1px solid rgba(35,39,52,.6)', borderRadius: 10,
    },

    // 操作按钮
    btnPrimary: {
      padding: '8px 16px', borderRadius: 8, border: '1px solid #2563eb',
      background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer',
      fontSize: 13, fontFamily: 'inherit',
    },
    btnSecondary: {
      padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(35,39,52,.8)',
      background: '#14161f', color: '#aeb4c6', cursor: 'pointer',
      fontSize: 13, fontFamily: 'inherit',
    },

    // 加客户表单
    addForm: { margin: '10px 0', display: 'flex', gap: 8 },
    addInput: {
      padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(35,39,52,.8)',
      background: '#14161f', color: '#eef0f6', fontSize: 13, fontFamily: 'inherit', outline: 'none',
    },

    // 图例
    legend: { display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' as const,
      color: '#6f7588', fontSize: 11.5 },
    legendItem: { display: 'inline-flex', alignItems: 'center', gap: 5 },
    legendDot: (c: string): React.CSSProperties => ({
      width: 7, height: 7, borderRadius: '50%', background: c,
    }),
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        {/* ── 顶部：品牌 + 标题 + 今日 AI 规划 ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={S.brandRow}>
              <span style={S.brandDot} />
              ZenithJoy · Line 04 私域客户
            </div>
            <h1 style={S.title}>
              AI 客户<em style={S.titleEm}>运营台</em>
            </h1>
            <p style={S.sub}>不是给人看的客户表 —— 是 AI 读取、按 A1–A5 规划下一步动作的工作面。</p>
          </div>
          <div style={S.planCard}>
            <h3 style={S.planTitle}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e3b169',
                animation: 'pulse 2s infinite', display: 'inline-block' }} />
              今日 AI 规划
            </h3>
            <div style={S.planNums}>
              <div style={S.planNum}>
                <b style={S.planNumB}>{statsToday}</b>
                <span style={S.planNumSpan}>今日待维护</span>
              </div>
              <div style={S.planNum}>
                <b style={S.planNumB}>{statsHighIntent}</b>
                <span style={S.planNumSpan}>高意向待推进</span>
              </div>
              <div style={S.planNum}>
                <b style={S.planNumB}>{statsNoContact}</b>
                <span style={S.planNumSpan}>3天未回</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── onboarding 状态条 O1-O5 ── */}
        {onboarding && (
          <div data-testid="crm-onboarding-bar" style={S.onboardBar}>
            {ONBOARDING_STEPS.map(s => {
              const state = onboarding[s.key] as OnboardingStepState;
              let extra = '';
              if (s.key === 'step_o2_scanned') extra = `（${onboarding.scanned_count}人）`;
              if (s.key === 'step_o3_roster') extra = `（黑名单${onboarding.blacklist_count}人）`;
              return (
                <div key={s.key} data-testid="crm-onboarding-step" data-step={s.key}
                  title={s.hint} style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: '#aeb4c6' }}>
                  <StepDot state={state} />
                  {s.label}
                  {extra && <span style={{ color: '#6f7588', marginLeft: 2 }}>{extra}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 操作区 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
          <button
            data-testid="crm-force-scan-btn"
            onClick={() => void onForceScan()}
            disabled={scanning || !csWechatId}
            style={{ ...S.btnPrimary, opacity: scanning || !csWechatId ? 0.6 : 1,
              cursor: scanning || !csWechatId ? 'not-allowed' : 'pointer' }}
            title="让客服机立刻扫一遍微信好友，把客户导进来"
          >
            {scanning ? '通知中…' : '扫一遍微信好友导入客户'}
          </button>
          <button
            data-testid="crm-add-customer-btn"
            onClick={() => setAdding(v => !v)}
            style={S.btnSecondary}
          >
            ＋加客户
          </button>
        </div>

        {adding && (
          <div data-testid="crm-add-form" style={S.addForm}>
            <input data-testid="crm-add-name" placeholder="客户姓名/昵称"
              value={newName} onChange={e => setNewName(e.target.value)} style={S.addInput} />
            <input data-testid="crm-add-wechat" placeholder="微信号（可空）"
              value={newWechatId} onChange={e => setNewWechatId(e.target.value)} style={S.addInput} />
            <button data-testid="crm-add-submit" onClick={() => void onAddCustomer()}
              style={S.btnPrimary}>入册</button>
          </div>
        )}

        {/* ── 状态提示 ── */}
        {authExpired && (
          <div role="alert" data-testid="crm-auth-expired" style={{ color: '#f87171', margin: '8px 0', fontSize: 13 }}>
            登录已失效，请重新登录
          </div>
        )}
        {toast && (
          <div data-testid="crm-toast" style={{ color: '#4ade80', margin: '8px 0', fontSize: 13 }}>
            {toast}
          </div>
        )}

        {/* ── 搜索 + 过滤 Toolbar ── */}
        <div style={S.bar}>
          <div style={S.searchWrap}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: '#6f7588', pointerEvents: 'none' }}
              width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx={11} cy={11} r={7} /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              data-testid="crm-search"
              value={searchQ}
              placeholder="搜客户名 / 微信号…"
              onChange={e => setSearchQ(e.target.value)}
              style={S.searchInput}
            />
          </div>
          <div style={S.chips}>
            {STATUS_OPTIONS.map(k => {
              const on = intentSel.has(k);
              const color = STATUS_COLORS[k];
              return (
                <div key={k} data-testid={`crm-chip-${k}`}
                  style={S.chip(on, on ? color : undefined)}
                  onClick={() => toggleIntent(k)}>
                  <span style={S.chipDot(color)} />
                  {STATUS_LABELS[k]}
                </div>
              );
            })}
          </div>
          <div style={S.spacer} />
          <div style={S.count}>
            <b data-testid="crm-customer-count" style={S.countB}>{filteredRows.length}</b>{' '}
            位客户
          </div>
        </div>

        {/* ── Glide Data Grid ── */}
        {loading ? (
          <div style={{ color: '#6f7588', padding: '32px 0', textAlign: 'center' }}>加载中…</div>
        ) : error && !authExpired ? (
          <div role="alert" style={{ color: '#f87171', padding: '16px 0' }}>错误：{error}</div>
        ) : filteredRows.length === 0 ? (
          <div data-testid="crm-empty" style={{ color: '#6f7588', padding: '32px 0', textAlign: 'center' }}>
            暂无好友。等客服机 agent 扫一轮后自动出现，或点「扫一遍微信好友导入客户」立刻扫，
            或点「＋加客户」手动入册。
          </div>
        ) : (
          <div data-testid="crm-glide-grid" style={S.gridFrame}>
            <DataEditor
              columns={COLS}
              rows={filteredRows.length}
              getCellContent={getCellContent}
              onCellClicked={onCellClicked}
              theme={DARK_THEME}
              width="100%"
              height="100%"
              rowHeight={46}
              headerHeight={42}
              smoothScrollX
              smoothScrollY
              rowMarkers="none"
              verticalBorder={false}
              getCellsForSelection
            />
          </div>
        )}

        {/* ── 编辑面板（DOM，自动选中首行；点 Glide 行切换）── */}
        {editingRow && !loading && (
          <div data-testid="crm-edit-panel" style={S.editPanel}>
            {/* 字母头像 */}
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: STATUS_COLORS[editingRow.status] ?? '#7a8092',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 700, color: '#0c0d11',
            }}>
              {(editingRow.name || editingRow.contact).charAt(0)}
            </div>
            {/* 名字 + 微信号 + 加微信时间 */}
            <div>
              <button
                type="button"
                data-testid="crm-customer-name"
                onClick={() => openProfile(editingRow)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: '#e3b169', fontWeight: 600, fontSize: 14, padding: 0, fontFamily: 'inherit' }}
                title="点开看画像 / 状态 / 聊天记录"
              >
                {editingRow.name || editingRow.contact}
              </button>
              <div style={{ fontSize: 11, color: '#6f7588', marginTop: 2 }}>
                <span data-testid="crm-customer-wechat-id">{editingRow.wechat_id || '—'}</span>
                <span style={{ margin: '0 5px' }}>·</span>
                <span data-testid="crm-customer-add-friend-time">{fmtTime(editingRow.add_friend_time ?? null)}</span>
              </div>
            </div>
            {/* 意向下拉 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <label style={S.editLabel}>意向</label>
              <select
                data-testid="crm-status-select"
                value={editingRow.status}
                onChange={e => void onChangeStatus(editingRow, e.target.value as CrmStatus)}
                style={{ ...S.editSelect, color: STATUS_COLORS[editingRow.status] ?? '#aeb4c6' }}
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            {/* 身份下拉 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <label style={S.editLabel}>身份</label>
              <select
                data-testid="crm-identity-select"
                value={currentIdentity(editingRow)}
                onChange={e => void onChangeIdentity(editingRow, e.target.value as CrmIdentity)}
                style={{ ...S.editSelect, color: IDENTITY_COLORS[currentIdentity(editingRow)] ?? '#aeb4c6' }}
              >
                {IDENTITY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{IDENTITY_LABELS[opt]}</option>
                ))}
              </select>
            </div>
            <div style={{ ...S.editLabel, marginLeft: 'auto' }}>
              点击上方表格行可切换编辑对象
            </div>
          </div>
        )}

        {/* ── 图例 ── */}
        <div style={S.legend}>
          {STATUS_OPTIONS.map(k => (
            <i key={k} style={S.legendItem}>
              <span style={S.legendDot(STATUS_COLORS[k])} />
              {STATUS_LABELS[k]}
            </i>
          ))}
        </div>
      </div>
    </div>
  );
}
