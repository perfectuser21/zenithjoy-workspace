import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';

interface Field {
  name: string;
  apiName: string;
  kind: string;
}
interface Operation {
  id: string;
  label: string;
  category: string;
  fields: Field[];
  documentation: string;
  destructive: boolean;
}

const defaults: Record<string, string> = {
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  formatType: 'text',
};
const names: Record<string, string> = {
  sourceTextList: '待翻译文本',
  sourceLanguage: '源语言',
  targetLanguage: '目标语言',
  imageUrl: '图片地址',
  productUrl: '商品地址',
  url: '文件地址',
  videoUrl: '视频地址',
  taskId: '任务 ID',
  formatType: '文本格式',
  glossary: '术语表 ID',
};

function buildParams(
  operation: Operation,
  values: Record<string, string>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of operation.fields) {
    const raw = values[field.name]?.trim();
    if (!raw) continue;
    if (field.kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw new Error(`${field.apiName} 必须选择是或否`);
      params[field.name] = raw === 'true';
    } else if (field.kind === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`${field.apiName} 必须是数字`);
      params[field.name] = number;
    } else if (field.kind === 'array' || field.kind === 'object' || field.kind === 'map') {
      if (field.name === 'sourceTextList' && !raw.startsWith('[')) params[field.name] = [raw];
      else {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (field.kind === 'array' && !Array.isArray(parsed)) throw new Error('array');
          if (
            field.kind !== 'array' &&
            (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          )
            throw new Error('object');
          params[field.name] = parsed;
        } catch {
          throw new Error(
            `${field.apiName} 需要有效的 JSON ${field.kind === 'array' ? '数组' : '对象'}`
          );
        }
      }
    } else params[field.name] = raw;
  }
  return params;
}

function resultValue(result: unknown, key: string): unknown {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  return record[key] ?? record[key[0].toLowerCase() + key.slice(1)];
}

export default function AidgeWorkspacePage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [category, setCategory] = useState('翻译');
  const [selectedId, setSelectedId] = useState('textTranslate');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploadingField, setUploadingField] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<unknown>(null);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const response = await fetch('/api/aidge/catalog', { credentials: 'include' });
      if (!response.ok)
        throw new Error(response.status === 401 ? '请先登录已授权账号' : '能力目录暂时无法加载');
      const data: { operations?: Operation[] } = await response.json();
      if (!Array.isArray(data.operations) || !data.operations.length)
        throw new Error('能力目录暂时为空');
      setOperations(data.operations);
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : '能力目录暂时无法加载');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const categories = useMemo(
    () => Array.from(new Set(operations.map((item) => item.category))),
    [operations]
  );
  const visible = useMemo(
    () =>
      operations.filter(
        (item) =>
          item.category === category &&
          `${item.label} ${item.id}`.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [operations, category, search]
  );
  const selected = operations.find((item) => item.id === selectedId);
  const data = resultValue(result, 'Data');
  const translations = resultValue(data, 'Translations');
  const translatedText = Array.isArray(translations)
    ? resultValue(translations[0], 'TranslatedText')
    : undefined;
  const taskId = resultValue(data, 'TaskId');

  const select = (item: Operation) => {
    setSelectedId(item.id);
    setValues(defaults);
    setConfirmed(false);
    setResult(null);
    setError('');
  };
  const run = async (
    operation: string,
    params: Record<string, unknown>,
    confirmDestructive = false
  ) => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/aidge/execute', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          params,
          ...(confirmDestructive ? { confirmDestructive: true } : {}),
        }),
      });
      const body: Record<string, unknown> = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(typeof body.error === 'string' ? body.error : '请求失败，请稍后重试');
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试');
    } finally {
      setRunning(false);
    }
  };
  const submit = () => {
    if (!selected) return;
    try {
      const params = buildParams(selected, values);
      if (!Object.keys(params).length) throw new Error('请先填写接口参数');
      void run(selected.id, params, selected.destructive && confirmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请检查接口参数');
    }
  };
  const uploadField = async (field: string, file: File) => {
    setUploadingField(field);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/aidge/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body: { url?: string; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || '素材上传失败，请稍后重试');
      setValues((current) => ({ ...current, [field]: body.url! }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材上传失败，请稍后重试');
    } finally {
      setUploadingField('');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <header className="rounded-2xl border border-violet-200 bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-900 p-7 text-white shadow-lg dark:border-violet-800">
        <div className="flex items-center gap-2 text-sm text-violet-200">
          <Sparkles size={18} /> 员工工具
        </div>
        <h1 className="mt-3 text-3xl font-semibold">Aidge 能力中心</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100">
          阿里云电商经营助手的翻译、图片、视频、商品经营与巡检能力，按栏目选择后直接运行。
        </p>
        <Link
          to="/creative-canvas"
          className="mt-5 inline-flex items-center gap-2 text-sm text-violet-200 hover:text-white"
        >
          前往创作画布 <ArrowRight size={15} />
        </Link>
      </header>

      {loadingCatalog && (
        <p role="status" className="text-sm text-slate-500">
          正在加载 Aidge 能力目录…
        </p>
      )}
      {catalogError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {catalogError}
          <button type="button" onClick={() => void loadCatalog()} className="ml-3 underline">
            重试
          </button>
        </div>
      )}
      {!!operations.length && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section
            aria-label="能力目录"
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">能力栏目</h2>
              <span className="text-xs text-slate-500">{operations.length} 个接口</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setCategory(name);
                    const first = operations.find((item) => item.category === name);
                    if (first) select(first);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm ${category === name ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-violet-100 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {name}{' '}
                  <span className="opacity-70">
                    {operations.filter((item) => item.category === name).length}
                  </span>
                </button>
              ))}
            </div>
            <input
              aria-label="搜索能力"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索能力名称或 API"
              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
            />
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => select(item)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm ${selectedId === item.id ? 'border-violet-500 bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100' : 'border-slate-200 text-slate-700 hover:border-violet-300 dark:border-slate-700 dark:text-slate-200'}`}
                >
                  <span>{item.label}</span>
                  <span className="ml-3 font-mono text-xs opacity-60">{item.id}</span>
                </button>
              ))}
            </div>
            {!visible.length && <p className="text-sm text-slate-500">此栏目没有匹配结果。</p>}
          </section>

          {selected && (
            <section
              aria-label="能力操作"
              className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-violet-600 dark:text-violet-300">
                    {selected.category}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                    {selected.label}
                  </h2>
                  <p className="mt-1 font-mono text-xs text-slate-500">{selected.id}</p>
                </div>
                <a
                  href={selected.documentation}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline dark:text-violet-300"
                >
                  接口文档 <ExternalLink size={14} />
                </a>
              </div>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                填写阿里云接口参数后运行。图片、文档和视频需提供阿里云可访问的素材地址；调用可能消耗免费额度或产生费用。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {selected.fields.map((field) => (
                  <div
                    key={field.name}
                    className={`space-y-1.5 text-sm text-slate-700 dark:text-slate-200 ${field.name === 'sourceTextList' || field.kind === 'array' || field.kind === 'object' ? 'sm:col-span-2' : ''}`}
                  >
                    <span className="block">
                      {names[field.name] || field.apiName}{' '}
                      <span className="font-mono text-xs text-slate-400">{field.apiName}</span>
                    </span>
                    {field.kind === 'boolean' ? (
                      <select
                        aria-label={field.apiName}
                        value={values[field.name] || ''}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [field.name]: event.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"
                      >
                        <option value="">不设置</option>
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : field.name === 'sourceTextList' ||
                      field.kind === 'array' ||
                      field.kind === 'object' ? (
                      <textarea
                        aria-label={field.apiName}
                        value={values[field.name] || ''}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [field.name]: event.target.value }))
                        }
                        rows={field.name === 'sourceTextList' ? 4 : 3}
                        placeholder={
                          field.name === 'sourceTextList'
                            ? '输入一段文字；批量翻译可填 JSON 数组'
                            : field.kind === 'array'
                              ? '[...]'
                              : '{...}'
                        }
                        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-slate-600"
                      />
                    ) : (
                      <input
                        aria-label={field.apiName}
                        type={field.kind === 'number' ? 'number' : 'text'}
                        value={values[field.name] || ''}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [field.name]: event.target.value }))
                        }
                        placeholder={field.apiName}
                        className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
                      />
                    )}
                    {['imageUrl', 'videoUrl', 'url'].includes(field.name) && (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-violet-700 hover:underline dark:text-violet-300">
                        {uploadingField === field.name ? '上传中…' : '上传本地素材'}
                        <input
                          type="file"
                          className="sr-only"
                          disabled={!!uploadingField}
                          accept={
                            field.name === 'imageUrl'
                              ? 'image/png,image/jpeg,image/webp,image/bmp'
                              : field.name === 'videoUrl'
                                ? 'video/mp4,video/quicktime'
                                : '.pdf,.docx,image/*,video/*'
                          }
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadField(field.name, file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
              {selected.destructive && (
                <label className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  我确认删除陈列知识记录；此操作可能无法恢复。
                </label>
              )}
              <button
                type="button"
                disabled={running || !!uploadingField || (selected.destructive && !confirmed)}
                onClick={submit}
                className="rounded-lg bg-violet-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? '运行中…' : '运行能力'}
              </button>
              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200"
                >
                  {error}
                </p>
              )}
              {result !== null && (
                <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-emerald-900 dark:text-emerald-100">运行结果</h3>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(JSON.stringify(result, null, 2))
                      }
                      className="text-xs text-emerald-800 underline dark:text-emerald-200"
                    >
                      复制结果
                    </button>
                  </div>
                  {typeof translatedText === 'string' && (
                    <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-white">
                      {translatedText}
                    </p>
                  )}
                  {typeof taskId === 'string' && (
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => void run('queryAsyncTaskResult', { taskId })}
                      className="rounded-lg border border-emerald-400 px-3 py-1.5 text-sm text-emerald-900 dark:text-emerald-100"
                    >
                      查询任务结果
                    </button>
                  )}
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-700 dark:text-slate-200">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
