/**
 * CustomerListPage — Line04 中台 AI 客户运营台（AG Grid DOM 重做 2026-06-27）
 *
 * 路由：/wechat/crm（归进「私域客服」板块；旧 /customers 301 → 此处）
 *
 * 暗色 AI 运营台：AG Grid Community（DOM 渲染，修 Glide canvas 点击错位）。
 *  - AG Grid quartz-dark 主题 + 金色 CSS 变量
 *  - 行内编辑：意向/身份双击单元格 → 下拉选择 → onCellValueChanged 写回后端
 *  - 列偏好持久化：服务端（GET/PUT /api/crm/view-prefs）按账号存储，多视图扩展结构
 *    onGridReady 恢复列宽/顺序/排序/筛选/quickFilter；变更 debounce 600ms 写回
 *  - 点姓名或「打开主页 ↗」→ navigate /wechat/crm/:contact
 *
 * **保留所有现有行为（per-operator 契约 2026-06-25）**：
 *  - session fetch credentials:include，不注入超管头
 *  - onboarding 状态条 O1-O5
 *  - 扫好友按钮 + 加客户表单
 *  - PUT /customers/status + PUT /customers/identity
 *  - 意向 A1-A5 chip 筛选 + 搜索框 quickFilterText
 *
 * **意向色阶**（A4=成交金，A5=流失暗红，语义正确）：
 *  A1 新客#7a8092 · A2 沟通中#5b8cc4 · A3 意向#8f7bd6 · A4 成交#e3b169 · A5 流失#c0594d
 *
 * 注意：这个运营台自带暗色 surface，不跟随 dashboard 全局亮暗主题切换。
 */
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  ColumnState,
  GridReadyEvent,
  ModelUpdatedEvent,
  CellValueChangedEvent,
  ICellRendererParams,
} from 'ag-grid-community';

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

// ── 视图偏好（多视图扩展结构，本期只用 1 个默认视图） ────────────────────────
interface ViewDef {
  id: string;
  name: string;
  columnState: ColumnState[];
  sortModel: { colId: string; sort: 'asc' | 'desc' | null; sortIndex?: number }[];
  filterModel: Record<string, unknown>;
  quickFilter: string;
}
interface ViewPrefs {
  views: ViewDef[];
  activeViewId: string;
}

const DEFAULT_VIEW_ID = 'default';

function buildDefaultPrefs(): ViewPrefs {
  return {
    views: [{
      id: DEFAULT_VIEW_ID,
      name: '默认视图',
      columnState: [],
      sortModel: [],
      filterModel: {},
      quickFilter: '',
    }],
    activeViewId: DEFAULT_VIEW_ID,
  };
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

  // 搜索 & chip 过滤状态
  const [searchQ, setSearchQ] = useState('');
  const [intentSel, setIntentSel] = useState<Set<string>>(() => new Set());

  // AG Grid 显示计数（onModelUpdated 更新）
  const [displayedCount, setDisplayedCount] = useState(0);
  const gridRef = useRef<AgGridReact<CustomerRow>>(null);

  // 服务端偏好保存防抖 ref（600ms）
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 取当前值避免闭包过时
  const csWechatIdRef = useRef(csWechatId);
  const searchQRef = useRef(searchQ);
  useEffect(() => { csWechatIdRef.current = csWechatId; }, [csWechatId]);
  useEffect(() => { searchQRef.current = searchQ; }, [searchQ]);
  // 待应用的偏好（prefs 先到、grid 未 ready 时暂存）
  const pendingPrefsRef = useRef<ViewPrefs | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  }, []);

  // ── 服务端偏好持久化 ─────────────────────────────────────────────────────

  /** 把偏好应用到 AG Grid：恢复列宽/顺序/排序/筛选/quickFilter。 */
  const applyViewPrefs = useCallback((prefs: ViewPrefs) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const view = prefs.views.find(v => v.id === prefs.activeViewId) ?? prefs.views[0];
    if (!view) return;
    if (view.columnState?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.applyColumnState({ state: view.columnState as any[], applyOrder: true });
    }
    if (view.filterModel && Object.keys(view.filterModel).length > 0) {
      api.setFilterModel(view.filterModel);
    }
    if (view.quickFilter) {
      setSearchQ(view.quickFilter);
    }
  }, []);

  /** GET /api/crm/view-prefs → 恢复偏好；若 grid 尚未 ready 则暂存到 pendingPrefsRef。 */
  const loadViewPrefs = useCallback(async (csWid: string) => {
    if (!csWid) return;
    try {
      const res = await sessionFetch(`/api/crm/view-prefs?cs_wechat_id=${encodeURIComponent(csWid)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { data?: { prefs?: ViewPrefs | null } };
      const prefs = data?.data?.prefs;
      if (!prefs) return;
      const api = gridRef.current?.api;
      if (api) {
        applyViewPrefs(prefs);
      } else {
        // grid 还没 ready，暂存等 onGridReady 里消费
        pendingPrefsRef.current = prefs;
      }
    } catch { /* 偏好加载失败不影响主流程 */ }
  }, [applyViewPrefs]);

  /** PUT /api/crm/view-prefs（debounce 600ms），从 grid 读当前状态写回服务端。 */
  const saveViewPrefs = useCallback(() => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const csWid = csWechatIdRef.current;
      if (!csWid) return;
      const api = gridRef.current?.api;
      if (!api) return;
      const columnState = api.getColumnState();
      const sortModel = columnState
        .filter(c => c.sort != null)
        .map(c => ({ colId: c.colId ?? '', sort: c.sort ?? null, sortIndex: c.sortIndex ?? 0 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterModel = api.getFilterModel() as Record<string, any>;
      const prefs: ViewPrefs = {
        ...buildDefaultPrefs(),
        views: [{
          id: DEFAULT_VIEW_ID,
          name: '默认视图',
          columnState: columnState as ColumnState[],
          sortModel,
          filterModel,
          quickFilter: searchQRef.current,
        }],
      };
      void sessionFetch('/api/crm/view-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wechat_id: csWid, prefs }),
      }).catch(() => { /* 偏好保存失败静默忽略 */ });
    }, 600);
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
      if (data.cs_wechat_id) {
        setCsWechatId(data.cs_wechat_id);
      }
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
  // csWechatId 就绪后加载视图偏好 + onboarding
  useEffect(() => {
    if (csWechatId) {
      void loadViewPrefs(csWechatId);
    }
  }, [csWechatId, loadViewPrefs]);
  useEffect(() => { void loadOnboarding(csWechatId); }, [csWechatId, loadOnboarding]);

  // searchQ 变化时也触发偏好保存（debounced）
  useEffect(() => {
    if (csWechatIdRef.current) saveViewPrefs();
  }, [searchQ, saveViewPrefs]);

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

  // chip 过滤（不含搜索文字，搜索交给 AG Grid quickFilterText）
  const chipFilteredRows = useMemo(() => {
    return rows.filter(row => intentSel.size === 0 || intentSel.has(row.status));
  }, [rows, intentSel]);

  // chip 变化时同步初始计数
  useEffect(() => {
    setDisplayedCount(chipFilteredRows.length);
  }, [chipFilteredRows]);

  // ── AG Grid 事件处理 ────────────────────────────────────────────────────────

  // grid ready：消费暂存偏好（prefs 先到 grid 后 ready 的情况）
  const onGridReady = useCallback((params: GridReadyEvent<CustomerRow>) => {
    if (pendingPrefsRef.current) {
      applyViewPrefs(pendingPrefsRef.current);
      pendingPrefsRef.current = null;
    }
    // 触发一次计数更新
    setDisplayedCount(params.api.getDisplayedRowCount());
  }, [applyViewPrefs]);

  // 计数更新（quickFilterText 过滤后）
  const onModelUpdated = useCallback((event: ModelUpdatedEvent<CustomerRow>) => {
    setDisplayedCount(event.api.getDisplayedRowCount());
  }, []);

  // 列变更 → debounce 保存偏好（列宽/显隐/顺序/排序/筛选）
  const onColChange = useCallback(() => {
    saveViewPrefs();
  }, [saveViewPrefs]);

  // 行内编辑完成 → 写回后端
  // identity 列没有 field（用 valueGetter），靠 colDef.colId 识别
  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent<CustomerRow>) => {
    const row = event.data;
    if (!row) return;
    const id = event.colDef.field ?? event.colDef.colId;
    if (id === 'status') {
      await onChangeStatus(row, event.newValue as CrmStatus);
    } else if (id === 'identity') {
      await onChangeIdentity(row, event.newValue as CrmIdentity);
    }
  }, [onChangeStatus, onChangeIdentity]);

  // ── AG Grid 列定义 ─────────────────────────────────────────────────────────

  const columnDefs = useMemo<ColDef<CustomerRow>[]>(() => [
    {
      field: 'name',
      colId: 'name',
      headerName: '姓名',
      width: 150,
      pinned: 'left' as const,
      cellRenderer: (p: ICellRendererParams<CustomerRow>) =>
        `<span style="color:#fff;font-weight:600;cursor:pointer">${p.value ?? '—'}</span>`,
      onCellClicked: (p) => { if (p.data) openProfile(p.data); },
    },
    {
      field: 'wechat_id',
      colId: 'wechat_id',
      headerName: '微信号',
      width: 140,
      cellStyle: { color: '#8b91a4' },
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    {
      field: 'status',
      colId: 'status',
      headerName: '意向',
      width: 128,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: STATUS_OPTIONS },
      cellRenderer: (p: ICellRendererParams<CustomerRow>) => {
        const val = (p.value as CrmStatus) ?? 'A1';
        const color = STATUS_COLORS[val] ?? '#7a8092';
        const label = STATUS_LABELS[val] ?? val;
        return `<span style="color:${color};font-weight:600">● ${label}</span>`;
      },
    },
    {
      colId: 'identity',
      headerName: '身份',
      width: 120,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: IDENTITY_OPTIONS },
      // valueGetter 把计算后的 identity 作为单元格值，供编辑器和 cellRenderer 使用
      valueGetter: (p) => (p.data ? currentIdentity(p.data) : 'customer'),
      cellRenderer: (p: ICellRendererParams<CustomerRow>) => {
        const id = (p.value as CrmIdentity) ?? 'customer';
        const color = IDENTITY_COLORS[id] ?? '#aeb4c6';
        return `<span style="color:${color}">${IDENTITY_LABELS[id] ?? id}</span>`;
      },
      // identity 列没有 field，onCellValueChanged 靠 colDef.field 路由；
      // 这里单独用 colId 标识，编辑完成由 onCellValueChanged 通过 colDef.colId 识别
    },
    {
      field: 'add_friend_time',
      colId: 'add_friend_time',
      headerName: '加微信',
      width: 96,
      cellStyle: { color: '#8b91a4' },
      valueFormatter: (p) => fmtDate(p.value as string | null),
    },
    {
      field: 'last_contact_at',
      colId: 'last_contact_at',
      headerName: '最近联系',
      width: 110,
      cellStyle: { color: '#aeb4c6' },
      valueFormatter: (p) => fmtDate(p.value as string | null),
    },
    {
      field: 'last_message',
      colId: 'last_message',
      headerName: '最后消息',
      width: 200,
      cellStyle: (p) => ({
        color: (p.data?.status === 'A3' || p.data?.status === 'A4') ? '#e3b169' : '#6f7588',
      }),
      valueFormatter: (p) => (p.value as string | null) ?? '—',
    },
    {
      colId: 'open',
      headerName: '',
      width: 118,
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: () =>
        `<span style="color:#e3b169;font-weight:600;cursor:pointer;font-size:12.5px">打开主页 ↗</span>`,
      onCellClicked: (p) => { if (p.data) openProfile(p.data); },
    },
  ], [openProfile]);

  // ── 今日 AI 规划统计 ──────────────────────────────────────────────────────
  const statsToday = rows.filter(r => currentIdentity(r) !== 'internal' && ['A1', 'A2', 'A3'].includes(r.status)).length;
  const statsHighIntent = rows.filter(r => r.status === 'A3').length;
  const statsNoContact = rows.filter(r => {
    if (!r.last_contact_at) return true;
    return Date.now() - new Date(r.last_contact_at).getTime() > 3 * 24 * 3600 * 1000;
  }).length;

  // ──────────────────────────────────────────────────────────────────────────────
  // 样式常量
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
    brandRow: { display: 'flex', alignItems: 'center', gap: 8, color: '#6f7588', fontSize: 12,
      letterSpacing: '.18em', textTransform: 'uppercase' as const, marginBottom: 8 },
    brandDot: { width: 7, height: 7, borderRadius: '50%', background: '#e3b169',
      boxShadow: '0 0 12px #e3b169' },
    title: { fontFamily: '"Fraunces",serif', fontWeight: 600, fontSize: 36,
      lineHeight: 1.05, margin: 0, letterSpacing: '-.01em' },
    titleEm: { fontStyle: 'italic', color: '#e3b169', fontWeight: 500 },
    sub: { color: '#aeb4c6', fontSize: 13.5, marginTop: 7, lineHeight: 1.5 },
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
    onboardBar: {
      display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 14,
      margin: '10px 0', padding: '10px 14px', background: '#14161f',
      border: '1px solid rgba(35,39,52,.6)', borderRadius: 10,
    },
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
    addForm: { margin: '10px 0', display: 'flex', gap: 8 },
    addInput: {
      padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(35,39,52,.8)',
      background: '#14161f', color: '#eef0f6', fontSize: 13, fontFamily: 'inherit', outline: 'none',
    },
    legend: { display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' as const,
      color: '#6f7588', fontSize: 11.5 },
    legendItem: { display: 'inline-flex', alignItems: 'center', gap: 5 },
    legendDot: (c: string): React.CSSProperties => ({
      width: 7, height: 7, borderRadius: '50%', background: c,
    }),
  };

  // AG Grid quartz-dark 主题 CSS 变量（金色运营台调色）
  const agThemeVars: React.CSSProperties = {
    // @ts-expect-error — CSS 自定义属性
    '--ag-background-color': '#14161f',
    '--ag-foreground-color': '#eef0f6',
    '--ag-header-background-color': '#101218',
    '--ag-header-foreground-color': '#9aa0b2',
    '--ag-border-color': '#232734',
    '--ag-row-border-color': '#1d212c',
    '--ag-row-hover-color': '#191c27',
    '--ag-selected-row-background-color': 'rgba(227,177,105,.10)',
    '--ag-accent-color': '#e3b169',
    '--ag-input-focus-border-color': '#e3b169',
    '--ag-odd-row-background-color': '#14161f',
    '--ag-font-family': '"Hanken Grotesk","PingFang SC",sans-serif',
    '--ag-font-size': '13px',
    '--ag-header-height': '44px',
    '--ag-row-height': '46px',
    '--ag-border-radius': '14px',
    '--ag-wrapper-border-radius': '16px',
    border: '1px solid #232734',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 30px 80px -30px rgba(0,0,0,.7)',
    height: 520,
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // 渲染
  // ──────────────────────────────────────────────────────────────────────────────

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
            <p style={S.sub}>双击意向/身份可直接编辑 · 拖动列边调宽 · 点列▾ 隐藏列 · 点姓名进主页。</p>
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

        {/* ── 搜索 + chip 过滤 Toolbar ── */}
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
            <b data-testid="crm-customer-count" style={S.countB}>{displayedCount}</b>{' '}
            位客户
          </div>
        </div>

        {/* ── AG Grid ── */}
        {loading ? (
          <div style={{ color: '#6f7588', padding: '32px 0', textAlign: 'center' }}>加载中…</div>
        ) : error && !authExpired ? (
          <div role="alert" style={{ color: '#f87171', padding: '16px 0' }}>错误：{error}</div>
        ) : chipFilteredRows.length === 0 ? (
          <div data-testid="crm-empty" style={{ color: '#6f7588', padding: '32px 0', textAlign: 'center' }}>
            暂无好友。等客服机 agent 扫一轮后自动出现，或点「扫一遍微信好友导入客户」立刻扫，
            或点「＋加客户」手动入册。
          </div>
        ) : (
          <div
            className="ag-theme-quartz-dark"
            style={agThemeVars}
          >
            <AgGridReact<CustomerRow>
              ref={gridRef}
              rowData={chipFilteredRows}
              columnDefs={columnDefs}
              defaultColDef={{ resizable: true, sortable: true, filter: true }}
              rowHeight={46}
              animateRows={true}
              quickFilterText={searchQ}
              onGridReady={onGridReady}
              onModelUpdated={onModelUpdated}
              onCellValueChanged={(e) => void onCellValueChanged(e)}
              onColumnResized={onColChange}
              onColumnVisible={onColChange}
              onColumnMoved={onColChange}
              onSortChanged={onColChange}
              onFilterChanged={onColChange}
              suppressMovableColumns={false}
            />
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

        {/* ── 使用提示 ── */}
        <div style={{ marginTop: 12, color: '#6f7588', fontSize: 12, lineHeight: 1.7 }}>
          <b style={{ color: '#caa15f' }}>使用：</b>
          ① 拖动列边调宽 ·
          ② 点表头排序 ·
          ③ 双击「意向」「身份」单元格行内编辑（自动保存）·
          ④ 点姓名或「打开主页 ↗」进客户画像页
        </div>
      </div>
    </div>
  );
}
