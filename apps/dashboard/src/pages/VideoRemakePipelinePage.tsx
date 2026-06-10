import { useState, useRef, useCallback } from 'react';

const API_BASE = '/api/video-remake';
const MAX_FILE_SIZE = 100 * 1024 * 1024;

interface VideoNode {
  node_id: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

interface VideoRemakeJob {
  job_id: string;
  filename: string;
  duration_seconds: number;
  width: number;
  height: number;
  status: string;
  nodes: VideoNode[];
}

const NODE_LABELS: Record<string, string> = {
  N01: '上传解析',
  N02: '抽帧',
  N03: '场景分析',
  N04: 'gpt-image-2重绘',
  N05: '帧评选',
  N06: '重绘审核',
  N07: '起始帧选择',
  N08: 'i2v生成',
  N09: '合成导出',
};

const STATUS_COLOR: Record<string, string> = {
  idle: '#d1d5db',
  running: '#f59e0b',
  done: '#10b981',
  error: '#ef4444',
};

function NodeCard({
  node,
  onExpand,
  expanded,
}: {
  node: VideoNode;
  onExpand: () => void;
  expanded: boolean;
}) {
  return (
    <div
      data-node-id={node.node_id}
      data-testid={`node-${node.node_id}`}
      data-status={node.status}
      onClick={onExpand}
      style={{
        border: `2px solid ${STATUS_COLOR[node.status] ?? '#d1d5db'}`,
        borderRadius: 8,
        padding: '12px 16px',
        cursor: 'pointer',
        background: '#fff',
        minWidth: 140,
        userSelect: 'none',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>{node.node_id}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{NODE_LABELS[node.node_id] ?? node.label}</div>
      <div
        style={{
          marginTop: 6,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: STATUS_COLOR[node.status] ?? '#d1d5db',
        }}
      />
      {expanded && (
        <div
          data-testid={`node-panel-${node.node_id}`}
          data-node-panel={node.node_id}
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 10,
            background: '#f9fafb',
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            color: '#374151',
            maxHeight: 200,
            overflow: 'auto',
            textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Output:</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(node.output, null, 2)}
          </pre>
          {node.node_id === 'N03' && (node.output as { original_frame_url?: string; prompt_text?: string }).original_frame_url && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontWeight: 600 }}>原帧：</span>
              <span>{(node.output as { original_frame_url?: string }).original_frame_url}</span>
              <br />
              <span style={{ fontWeight: 600 }}>Prompt：</span>
              <span>{(node.output as { prompt_text?: string }).prompt_text}</span>
            </div>
          )}
          {node.node_id === 'N04' && (node.output as { original_frame_url?: string; redrawn_frame_url?: string }).redrawn_frame_url && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontWeight: 600 }}>原帧：</span>
              <span>{(node.output as { original_frame_url?: string }).original_frame_url}</span>
              <br />
              <span style={{ fontWeight: 600 }}>重绘帧：</span>
              <span>{(node.output as { redrawn_frame_url?: string }).redrawn_frame_url}</span>
            </div>
          )}
          {node.node_id === 'N05' &&
            Array.isArray((node.output as { frames?: unknown[] }).frames) && (
              <div style={{ marginTop: 4 }}>
                {((node.output as { frames?: Array<{ redrawn_frame_url: string; score: number }> }).frames ?? []).map(
                  (f, i) => (
                    <div key={i}>
                      Frame {i}: score={f.score}
                    </div>
                  )
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export default function VideoRemakePipelinePage() {
  const [job, setJob] = useState<VideoRemakeJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const resp = await fetch(`${API_BASE}/jobs/${jobId}`);
      const data: VideoRemakeJob = await resp.json();
      setJob(data);

      if (data.status === 'completed') {
        const outResp = await fetch(`${API_BASE}/jobs/${jobId}/output`);
        const out = await outResp.json();
        setDownloadUrl(out.download_url);
        return;
      }
      if (data.status === 'failed') return;

      // auto-continue N06 if CI or after delay
      const n06 = data.nodes.find((n) => n.node_id === 'N06');
      const n07 = data.nodes.find((n) => n.node_id === 'N07');
      if (n06?.status === 'done' && n07?.status === 'idle') {
        const ci = process.env.CI === 'true' || (import.meta as { env?: { CI?: string } }).env?.CI === 'true';
        if (ci) {
          await fetch(`${API_BASE}/jobs/${jobId}/nodes/N07/select`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ci_auto: true }),
          });
        }
      }

      pollingRef.current = setTimeout(() => pollJob(jobId), 2000);
    } catch {
      pollingRef.current = setTimeout(() => pollJob(jobId), 3000);
    }
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        setError('文件过大：最大支持 100MB');
        return;
      }
      if (pollingRef.current) clearTimeout(pollingRef.current);
      setJob(null);
      setDownloadUrl(null);

      const form = new FormData();
      form.append('video', file);
      try {
        const resp = await fetch(`${API_BASE}/jobs`, { method: 'POST', body: form });
        if (!resp.ok) {
          const d = await resp.json();
          setError(d.error ?? 'Upload failed');
          return;
        }
        const data = await resp.json();
        pollJob(data.job_id);
      } catch (err) {
        setError(String(err));
      }
    },
    [pollJob]
  );

  const handleContinueN06 = useCallback(async () => {
    if (!job) return;
    await fetch(`${API_BASE}/jobs/${job.job_id}/nodes/N06/continue`, { method: 'POST' });
    pollJob(job.job_id);
  }, [job, pollJob]);

  const initialNodes: VideoNode[] = Object.keys(NODE_LABELS).map((id) => ({
    node_id: id,
    label: NODE_LABELS[id],
    status: 'idle',
    input: {},
    output: {},
  }));

  const nodes = job?.nodes ?? initialNodes;

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
        AI 爆款视频翻拍流水线
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        上传源视频，9 节点 AI 流水线自动翻拍为爆款风格
      </p>

      {/* 上传区 */}
      <div
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
          marginBottom: 32,
          background: '#fafafa',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          data-testid="file-input"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 24px',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          选择视频文件
        </button>
        <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>支持 MP4，最大 100MB</p>
        {job && (
          <p style={{ color: '#374151', fontSize: 13, marginTop: 4 }}>
            {job.filename} · {job.duration_seconds}s · {job.width}×{job.height}
          </p>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          data-testid="error-message"
          role="alert"
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#dc2626',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 24,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* 9节点流水线图 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 16 }}>
          9 节点流水线
        </h2>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          {nodes.map((node) => (
            <NodeCard
              key={node.node_id}
              node={node}
              expanded={expandedNode === node.node_id}
              onExpand={() =>
                setExpandedNode(expandedNode === node.node_id ? null : node.node_id)
              }
            />
          ))}
        </div>
      </div>

      {/* N06 手动审核按钮（非CI时显示） */}
      {job?.nodes.find((n) => n.node_id === 'N06')?.status === 'running' && (
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={handleContinueN06}
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Continue（确认重绘帧序列）
          </button>
        </div>
      )}

      {/* 下载区 */}
      {downloadUrl && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ color: '#065f46', fontWeight: 600, marginBottom: 12 }}>翻拍完成！</p>
          <a
            href={downloadUrl}
            download
            data-testid="download-btn"
            style={{
              background: '#10b981',
              color: '#fff',
              borderRadius: 8,
              padding: '10px 24px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            下载翻拍 MP4
          </a>
        </div>
      )}

      {/* 状态信息 */}
      {job && (
        <div style={{ marginTop: 16, fontSize: 12, color: '#9ca3af' }}>
          Job ID: {job.job_id} · 状态: {job.status}
        </div>
      )}
    </div>
  );
}
