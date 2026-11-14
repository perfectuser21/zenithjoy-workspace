import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchWorkerCapability, type WorkerCapability } from '../api/pipeline.api'

const STAGE_LABELS: Record<string, string> = {research:'调研', copywriting:'文案', copy_review:'文案审核', generate:'图片', image_review:'图片审核', export:'导出'}

export default function ContentTypeConfigPage() {
  const [capability, setCapability] = useState<WorkerCapability | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetchWorkerCapability().then(value => { if (active) setCapability(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '加载失败') })
    return () => { active = false }
  }, [])
  return <div className="max-w-3xl mx-auto space-y-5">
    <h1 className="text-2xl font-semibold">内容执行能力</h1>
    <p className="text-sm text-gray-600">内容流程由 ZenithJoy 执行，任务统一在 Brain 登记并由 Worker 认领。</p>
    {error ? <p role="alert" className="text-red-600">{error}</p> : !capability ? <p>加载中…</p> : <section className="bg-white rounded-xl border p-5 space-y-3">
      <h2 className="font-medium">{capability.label}</h2>
      <p className="text-sm font-mono">{capability.content_type}</p>
      <ol className="flex flex-wrap gap-3 text-sm">{capability.stages.map((stage, i) => <li key={stage}>{i + 1}. {STAGE_LABELS[stage] || stage}</li>)}</ol>
      <p className="text-sm text-gray-600">Notebook 随选题保存；未填写时使用执行器的默认 Notebook。</p>
    </section>}
    <Link className="text-indigo-700" to="/content-factory">前往选题池设置 Notebook</Link>
  </div>
}
