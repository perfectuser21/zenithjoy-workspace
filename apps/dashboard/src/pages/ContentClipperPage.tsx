import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  submitClip,
  listClips,
  retryClip,
  getClipSettings,
  saveClipSettings,
  initiateFeishuOAuth,
  saveNotionToken,
  deleteFeishuBinding,
  deleteNotionBinding,
  type Clip,
} from '../api/content-clipper.api';

const extractUrl = (text: string): string => {
  // 标准 https:// URL
  const httpMatch = text.match(/https?:\/\/[^\s\u4e00-\u9fff\u3000-\u303f\u3010\u3011\uff0c\u3002\u3001\uff01\uff1f]+/);
  if (httpMatch) return httpMatch[0].replace(/[.,;:!?）)]+$/, '');
  // 小红书：😆 CODE 😆 格式
  const xhsMatch = text.match(/😆\s*([A-Za-z0-9]{8,20})\s*😆/);
  if (xhsMatch) return `https://xhslink.com/a/${xhsMatch[1]}`;
  // 抖音：混淆分享文案 CODE:/ 格式
  const douyinMatch = text.match(/([A-Za-z0-9]{3,12}):\//);
  if (douyinMatch && (text.includes('抖音') || text.includes('Dou音'))) {
    return `https://v.douyin.com/${douyinMatch[1]}/`;
  }
  return text.trim();
};

function detectOutputType(url: string): string | null {
  if (!url) return null;
  if (url.includes('notion.so') || url.includes('notion.site')) return 'notion';
  if (url.includes('feishu.cn') || url.includes('larksuite.com')) return 'feishu';
  return null;
}

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  done:       'bg-green-100 text-green-800',
  failed:     'bg-red-100 text-red-800',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', processing: '处理中', done: '完成', failed: '失败',
};
const PLATFORM_LABEL: Record<string, string> = {
  douyin: '抖音', xiaohongshu: '小红书',
};

export default function ContentClipperPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'clips' | 'settings'>('clips');

  const [pasteText, setPasteText] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const [settingUrl, setSettingUrl] = useState('');
  const [settingSaved, setSettingSaved] = useState(false);
  const [notionInput, setNotionInput] = useState('');
  const [notionSaving, setNotionSaving] = useState(false);
  const [notionError, setNotionError] = useState('');
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const feishuOAuthResult = searchParams.get('feishu');
  const oauthError = searchParams.get('error');

  const settingsQuery = useQuery({
    queryKey: ['clips', 'settings'],
    queryFn: getClipSettings,
    staleTime: 60_000,
  });

  const clipsQuery = useQuery({
    queryKey: ['clips', 'list', filterPlatform, filterStatus, page],
    queryFn: () => listClips({ platform: filterPlatform, status: filterStatus, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    refetchInterval: 5_000,
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      const cleanUrl = extractUrl(pasteText);
      return submitClip(cleanUrl, outputUrl.trim() || undefined);
    },
    onSuccess: () => {
      setSubmitMsg({ type: 'success', text: '已提交，正在采集...' });
      setPasteText('');
      setOutputUrl('');
      qc.invalidateQueries({ queryKey: ['clips', 'list'] });
    },
    onError: (err: Error) => setSubmitMsg({ type: 'error', text: err.message }),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => retryClip(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', 'list'] }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () => {
      const url = settingUrl || settingsQuery.data?.defaultOutputUrl || '';
      const type = detectOutputType(url);
      if (!type) throw new Error('无法识别链接类型（仅支持 Notion 和飞书）');
      return saveClipSettings({ defaultOutputUrl: url, defaultOutputType: type });
    },
    onSuccess: () => {
      setSettingSaved(true);
      qc.invalidateQueries({ queryKey: ['clips', 'settings'] });
      setTimeout(() => setSettingSaved(false), 2000);
    },
  });

  const saveNotionMutation = useMutation({
    mutationFn: () => saveNotionToken(notionInput),
    onSuccess: () => {
      setNotionInput('');
      setNotionError('');
      qc.invalidateQueries({ queryKey: ['clips', 'settings'] });
    },
    onError: (err: Error) => setNotionError(err.message === 'notion_token_invalid' ? 'Token 无效，请检查' : '保存失败'),
  });

  const deleteFeishuMutation = useMutation({
    mutationFn: deleteFeishuBinding,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', 'settings'] }),
  });

  const deleteNotionMutation = useMutation({
    mutationFn: deleteNotionBinding,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', 'settings'] }),
  });

  const clips = clipsQuery.data?.data ?? [];
  const total = clipsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const defaultOutputUrl = settingsQuery.data?.defaultOutputUrl ?? '';
  const previewOutputType = detectOutputType(outputUrl);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">内容采集</h1>

      <div className="flex gap-4 border-b mb-6">
        {(['clips', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'clips' ? '采集列表' : '设置'}
          </button>
        ))}
      </div>

      {tab === 'clips' && (
        <>
          <div className="bg-white border rounded-lg p-4 mb-6 space-y-3">
            <textarea
              className="w-full border rounded-md p-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="粘贴抖音/小红书链接或完整分享文字..."
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setSubmitMsg(null); }}
            />
            <input
              type="text"
              className="w-full border rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={`输出链接（可选，默认：${defaultOutputUrl || '未设置'}）`}
              value={outputUrl}
              onChange={(e) => setOutputUrl(e.target.value)}
            />
            {previewOutputType && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {previewOutputType === 'notion' ? 'Notion' : '飞书多维表格'}
              </span>
            )}
            {submitMsg && (
              <p className={`text-sm ${submitMsg.type === 'error' ? 'text-red-600' : submitMsg.type === 'info' ? 'text-blue-600' : 'text-green-600'}`}>
                {submitMsg.text}
              </p>
            )}
            <button
              onClick={() => submitMutation.mutate()}
              disabled={!pasteText.trim() || submitMutation.isPending}
              className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitMutation.isPending ? '提交中...' : '提交采集'}
            </button>
          </div>

          <div className="flex gap-3 mb-4">
            <select value={filterPlatform} onChange={(e) => { setFilterPlatform(e.target.value); setPage(0); }}
              className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">全部平台</option>
              <option value="douyin">抖音</option>
              <option value="xiaohongshu">小红书</option>
            </select>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
              className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">全部状态</option>
              <option value="pending">待处理</option>
              <option value="processing">处理中</option>
              <option value="done">完成</option>
              <option value="failed">失败</option>
            </select>
            <span className="ml-auto text-sm text-gray-500 self-center">共 {total} 条</span>
          </div>

          {clipsQuery.isLoading ? (
            <p className="text-sm text-gray-500 text-center py-8">加载中...</p>
          ) : clips.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">暂无记录，粘贴链接开始采集</p>
          ) : (
            <div className="space-y-2">
              {clips.map((clip: Clip) => (
                <div key={clip.id}
                  className="bg-white border rounded-lg p-3 flex items-start gap-3 cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => navigate(`/clips/${clip.id}`)}>
                  {clip.cover_url && (
                    <img src={clip.cover_url} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[clip.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[clip.status] || clip.status}
                      </span>
                      <span className="text-xs text-gray-400">{PLATFORM_LABEL[clip.platform] || clip.platform}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{clip.title || clip.url}</p>
                    {clip.author && <p className="text-xs text-gray-500 mt-0.5">@{clip.author}</p>}
                    {clip.ocr_text && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">
                        {clip.ocr_text.slice(0, 120)}
                      </p>
                    )}
                    {clip.status === 'failed' && (
                      <p className="text-xs text-red-500 mt-1 truncate">{clip.error_msg}</p>
                    )}
                  </div>
                  {clip.status === 'failed' && (
                    <button onClick={(e) => { e.stopPropagation(); retryMutation.mutate(clip.id); }}
                      className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded px-2 py-1 hover:bg-orange-100 transition-colors flex-shrink-0">
                      重试
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1 text-sm border rounded disabled:opacity-40">上一页</button>
              <span className="px-3 py-1 text-sm">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border rounded disabled:opacity-40">下一页</button>
            </div>
          )}
        </>
      )}

      {tab === 'settings' && (
        <div className="space-y-4 max-w-lg">
          {/* 飞书 Bitable */}
          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">飞书 Bitable</h3>
              {settingsQuery.data?.feishuBound ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                  已绑定：{settingsQuery.data.feishuUserName || '飞书用户'}
                </span>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">未绑定</span>
              )}
            </div>
            {feishuOAuthResult === 'bound' && (
              <p className="text-sm text-green-600 mb-2">飞书账号绑定成功 ✓</p>
            )}
            {oauthError === 'feishu_failed' && (
              <p className="text-sm text-red-500 mb-2">飞书绑定失败，请重试</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={initiateFeishuOAuth}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                {settingsQuery.data?.feishuBound ? '重新绑定' : '绑定飞书'}
              </button>
              {settingsQuery.data?.feishuBound && (
                <button
                  onClick={() => deleteFeishuMutation.mutate()}
                  disabled={deleteFeishuMutation.isPending}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">
                  解除绑定
                </button>
              )}
            </div>
          </div>

          {/* Notion */}
          <div className="bg-white border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">Notion</h3>
              {settingsQuery.data?.notionBound ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">已绑定</span>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">未绑定</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-2">
              在{' '}
              <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer"
                className="underline text-blue-600">Notion 集成设置</a>{' '}
              创建 Integration 并复制 Token（以 ntn_ 或 secret_ 开头）
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="ntn_xxxx 或 secret_xxxx..."
                value={notionInput}
                onChange={(e) => { setNotionInput(e.target.value); setNotionError(''); }}
                className="flex-1 text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                disabled={!notionInput || notionSaving || saveNotionMutation.isPending}
                onClick={() => { setNotionSaving(true); saveNotionMutation.mutate(); setNotionSaving(false); }}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {saveNotionMutation.isPending ? '验证中...' : '保存'}
              </button>
              {settingsQuery.data?.notionBound && (
                <button
                  onClick={() => deleteNotionMutation.mutate()}
                  disabled={deleteNotionMutation.isPending}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">
                  删除
                </button>
              )}
            </div>
            {notionError && <p className="text-sm text-red-500 mt-1">{notionError}</p>}
          </div>

          {/* 默认输出链接（已绑定才展示） */}
          {(settingsQuery.data?.feishuBound || settingsQuery.data?.notionBound) && (
            <div className="bg-white border rounded-lg p-5">
              <h3 className="font-medium text-gray-900 mb-3">默认输出链接（可选）</h3>
              <input type="text"
                className="w-full border rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="粘贴 Notion 数据库链接或飞书多维表格链接"
                defaultValue={settingsQuery.data?.defaultOutputUrl ?? ''}
                onChange={(e) => setSettingUrl(e.target.value)}
              />
              {detectOutputType(settingUrl || settingsQuery.data?.defaultOutputUrl || '') && (
                <p className="text-xs text-gray-500 mt-1">
                  已识别：{detectOutputType(settingUrl || settingsQuery.data?.defaultOutputUrl || '') === 'notion' ? 'Notion 数据库' : '飞书多维表格'}
                </p>
              )}
              <p className="text-xs text-gray-400 mt-1">每次提交时若不填输出链接，将自动推送到此地址</p>
              <button
                onClick={() => saveSettingsMutation.mutate()}
                disabled={saveSettingsMutation.isPending}
                className="mt-3 bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {settingSaved ? '已保存 ✓' : saveSettingsMutation.isPending ? '保存中...' : '保存设置'}
              </button>
              {saveSettingsMutation.isError && (
                <p className="text-sm text-red-600">{(saveSettingsMutation.error as Error).message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
