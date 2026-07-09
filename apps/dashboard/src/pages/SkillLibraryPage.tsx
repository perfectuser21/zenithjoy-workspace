import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

const API_LIBRARY = '/api/staff/skill-eval/library';
const API_LIBRARY_LINE = (journeyId: string) => `/api/staff/skill-eval/library/${journeyId}`;

const VERDICT_CONFIG = {
  pass: { label: '可以用', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  partial: { label: '改了能用', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  fail: { label: '还不能用', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

interface SkillVersion {
  task_id: string;
  skill_name: string;
  created_at: string;
  verdict_level: 'pass' | 'partial' | 'fail' | null;
  verdict_text: string | null;
  stats: { function_count?: number; defects_high?: number } | null;
  report_url: string | null;
}

interface SkillGroup {
  skill_name: string;
  versions: SkillVersion[];
}

interface LineData {
  journey_id: string;
  skills: SkillGroup[];
  total: number;
}

interface LibrarySummary {
  total: number;
  by_line: Record<string, Array<{ skill_name: string; task_id: string; verdict_level: string | null }>>;
}

export default function SkillLibraryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [lineData, setLineData] = useState<LineData | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [lineLoading, setLineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await adminFetch(API_LIBRARY, user?.email);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        setSummary(json.data ?? json);
      } catch (e) {
        setError(`加载失败：${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.email]);

  const loadLine = async (journeyId: string) => {
    if (selectedLine === journeyId) {
      setSelectedLine(null);
      setLineData(null);
      return;
    }
    setSelectedLine(journeyId);
    setLineLoading(true);
    try {
      const res = await adminFetch(API_LIBRARY_LINE(journeyId), user?.email);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setLineData(json.data ?? json);
    } catch (e) {
      setError(`加载失败：${(e as Error).message}`);
    } finally {
      setLineLoading(false);
    }
  };

  const toggleSkill = (skillName: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) next.delete(skillName);
      else next.add(skillName);
      return next;
    });
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const lineNames: Record<string, string> = {
    line00: 'Line 00 — 运营中枢',
    line01: 'Line 01 — 智能发布',
    line02: 'Line 02 — 客户获客',
    line03: 'Line 03 — GEO',
    line04: 'Line 04 — 私域 AI 接管',
    line05: 'Line 05 — 视频剪辑',
    line06: 'Line 06 — 小龙虾',
    line07: 'Line 07 — AI 爆款视频',
    line10: 'Line 10 — 客户管理',
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <button
          onClick={() => navigate('/staff/skill-eval')}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          <ArrowLeft size={14} /> 返回上传
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">技能库</span>
        {summary && (
          <span className="ml-2 text-xs text-gray-400">共 {summary.total} 次评测</span>
        )}
      </div>

      <div className="max-w-3xl mx-auto py-8 px-4">
        {loading && (
          <div className="flex items-center gap-2 text-blue-600 text-sm">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            加载中...
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && summary && Object.keys(summary.by_line).length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            还没有完成的评测记录。去<button onClick={() => navigate('/staff/skill-eval')} className="text-blue-600 underline mx-1">上传</button>第一个 Skill 吧。
          </div>
        )}

        {!loading && summary && (
          <div className="space-y-3">
            {Object.entries(summary.by_line).map(([lineId, items]) => (
              <div key={lineId} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <button
                  onClick={() => loadLine(lineId)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">{lineNames[lineId] || lineId}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{items.length} 个 Skill</div>
                  </div>
                  {selectedLine === lineId
                    ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                    : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                  }
                </button>

                {selectedLine === lineId && (
                  <div className="border-t border-gray-200 dark:border-slate-700 px-5 pb-4">
                    {lineLoading && (
                      <div className="py-6 flex items-center gap-2 text-blue-600 text-sm">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        加载中...
                      </div>
                    )}
                    {!lineLoading && lineData && lineData.skills.map((skillGroup) => (
                      <div key={skillGroup.skill_name} className="mt-4">
                        <button
                          onClick={() => toggleSkill(skillGroup.skill_name)}
                          className="flex items-center gap-2 text-left w-full group"
                        >
                          {expandedSkills.has(skillGroup.skill_name)
                            ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                            : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                          }
                          <span className="font-medium text-sm text-gray-900 dark:text-white">{skillGroup.skill_name}</span>
                          <span className="text-xs text-gray-400">{skillGroup.versions.length} 个版本</span>
                          {skillGroup.versions[0]?.verdict_level && (
                            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${VERDICT_CONFIG[skillGroup.versions[0].verdict_level]?.cls ?? ''}`}>
                              {VERDICT_CONFIG[skillGroup.versions[0].verdict_level]?.label ?? skillGroup.versions[0].verdict_level}
                            </span>
                          )}
                        </button>

                        {expandedSkills.has(skillGroup.skill_name) && (
                          <div className="mt-2 ml-5 space-y-2">
                            {skillGroup.versions.map((v, idx) => (
                              <div
                                key={v.task_id}
                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg"
                              >
                                <div className="flex-none w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400">
                                  v{skillGroup.versions.length - idx}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(v.created_at)}</div>
                                  {v.verdict_text && (
                                    <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 truncate">{v.verdict_text}</div>
                                  )}
                                  {v.stats && (
                                    <div className="text-xs text-gray-400 mt-0.5">
                                      {v.stats.function_count != null && `${v.stats.function_count} 功能线`}
                                      {v.stats.defects_high != null && v.stats.defects_high > 0 && ` · ${v.stats.defects_high} 高危缺陷`}
                                    </div>
                                  )}
                                </div>
                                {v.verdict_level && (
                                  <span className={`flex-none text-xs font-semibold px-2 py-0.5 rounded-full ${VERDICT_CONFIG[v.verdict_level]?.cls ?? ''}`}>
                                    {VERDICT_CONFIG[v.verdict_level]?.label ?? v.verdict_level}
                                  </span>
                                )}
                                <button
                                  onClick={() => navigate(`/staff/skill-eval/report/${v.task_id}`)}
                                  className="flex-none text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  查看报告
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
