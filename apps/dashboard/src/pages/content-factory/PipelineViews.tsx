import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react'
import type { Pipeline } from '../../api/pipeline.api'
import { CONTENT_TYPE_MAP, STATUS_COLORS, STATUS_LABELS, StageProgress, formatTime, getContentType } from './pipeline-display'

// ─── 排期日历 ─────────────────────────────────────────────────

export function ScheduleView({ pipelines }: { pipelines: Pipeline[] }) {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

  const byDate = pipelines.reduce<Record<string, Pipeline[]>>((acc, p) => {
    const date = p.created_at?.split('T')[0] || ''
    if (!acc[date]) acc[date] = []
    acc[date].push(p)
    return acc
  }, {})

  const selectedPipelines = byDate[selectedDate] || []

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-700">
            {new Date(weekDates[0]).toLocaleDateString('zh-CN', { month: 'long' })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          {weekDates.map((date, i) => {
            const count = (byDate[date] || []).length
            const isToday = date === new Date().toISOString().split('T')[0]
            const isSelected = date === selectedDate
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-gray-50 text-gray-700'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isSelected ? 'text-indigo-200' : 'text-gray-400'}`}>周{DAY_LABELS[i]}</span>
                  <span className={isToday && !isSelected ? 'font-bold text-indigo-600' : ''}>
                    {new Date(date + 'T12:00:00').getDate()}日
                  </span>
                </div>
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-4">
          {new Date(selectedDate + 'T12:00:00').toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          <span className="ml-2 text-gray-400 text-xs">共 {selectedPipelines.length} 项</span>
        </h3>
        {selectedPipelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <CalendarDays className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">当天没有排期内容</p>
          </div>
        ) : (
          <div className="space-y-3">
            {selectedPipelines.map(p => {
              const ct = getContentType(p)
              const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
              return (
                <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800 truncate block">{p.title || p.payload?.keyword || '未命名'}</span>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      <span>{typeLabel}</span>
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded border ${STATUS_COLORS[p.status] || ''}`}>
                        {p.status === 'queued' && !p.cecelia_task_id ? '待登记' : STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
                    <StageProgress status={p.status} />
                  </div>
                  <div className="text-xs text-gray-400 flex-shrink-0">{formatTime(p.started_at)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 执行状态 ─────────────────────────────────────────────────

export function ExecutionView({ pipelines }: { pipelines: Pipeline[] }) {
  const activeItems = pipelines.filter(p => p.status === 'in_progress' || p.status === 'queued')

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">执行中 / 排队中</span>
        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{activeItems.length}</span>
      </div>

      {activeItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center h-48 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">没有进行中的 Pipeline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeItems.map(p => {
            const ct = getContentType(p)
            const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800">{p.title || p.payload?.keyword || '未命名'}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{typeLabel}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status]}`}>
                        {p.status === 'queued' && !p.cecelia_task_id ? '待登记' : STATUS_LABELS[p.status]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mb-3">
                      开始：{formatTime(p.started_at)}
                    </div>
                    <StageProgress status={p.status} />

                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 主页面 ─────────────────────────────────────────────────────

