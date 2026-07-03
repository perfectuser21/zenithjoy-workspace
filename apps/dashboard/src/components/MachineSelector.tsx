import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Monitor } from 'lucide-react';
import { fetchMachines, type Machine } from '../api/machines.api';

const STORAGE_KEY = 'preferred_agent_id';
const POLL_MS = 30_000;

/**
 * 方案C：Dashboard 常驻"当前机器"感知。任务默认绑定到选中机器，多机时才弹选。
 * 0 台 online → 红色警告，禁止创建任务（此组件只负责展示 + 写 localStorage，
 * 是否拦截创建由调用方读 localStorage 自行判断）。
 */
export default function MachineSelector() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [selected, setSelected] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || '');

  const load = useCallback(async () => {
    try {
      const list = await fetchMachines();
      setMachines(list);
    } catch {
      setMachines([]);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (machines === null) return null;

  const online = machines.filter((m) => m.status === 'online');

  if (online.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10">
        <AlertTriangle className="w-3.5 h-3.5" />
        无在线机器
      </div>
    );
  }

  const selectedOnline = online.find((m) => m.agent_id === selected);

  // 之前选中的机器掉线了：清掉记忆，重新走"需要选择"分支
  if (selected && !selectedOnline) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-500/10">
          <AlertTriangle className="w-3.5 h-3.5" />
          选中机器已离线
        </div>
        <MachinePicker
          online={online}
          onSelect={(agentId) => {
            localStorage.setItem(STORAGE_KEY, agentId);
            setSelected(agentId);
          }}
        />
      </div>
    );
  }

  // 唯一一台 online 且未选过 → 自动选中，不弹
  if (online.length === 1 && !selectedOnline) {
    const only = online[0];
    localStorage.setItem(STORAGE_KEY, only.agent_id);
    // 用微任务方式更新 state，避免 render 期间 setState 警告
    if (selected !== only.agent_id) {
      queueMicrotask(() => setSelected(only.agent_id));
    }
    return <MachineBadge machine={only} />;
  }

  if (selectedOnline) {
    if (online.length === 1) return <MachineBadge machine={selectedOnline} />;
    return (
      <MachinePicker
        online={online}
        value={selectedOnline.agent_id}
        onSelect={(agentId) => {
          localStorage.setItem(STORAGE_KEY, agentId);
          setSelected(agentId);
        }}
      />
    );
  }

  // N 台 online 且没有历史选择 → 弹选择器
  return (
    <MachinePicker
      online={online}
      onSelect={(agentId) => {
        localStorage.setItem(STORAGE_KEY, agentId);
        setSelected(agentId);
      }}
    />
  );
}

function MachineBadge({ machine }: { machine: Machine }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-500/10">
      <Monitor className="w-3.5 h-3.5" />
      {machine.nickname || machine.hostname}
    </div>
  );
}

function MachinePicker({
  online,
  value,
  onSelect,
}: {
  online: Machine[];
  value?: string;
  onSelect: (agentId: string) => void;
}) {
  return (
    <select
      className="text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1"
      value={value ?? ''}
      onChange={(e) => onSelect(e.target.value)}
    >
      <option value="" disabled>
        选择机器…
      </option>
      {online.map((m) => (
        <option key={m.agent_id} value={m.agent_id}>
          {m.nickname || m.hostname}
        </option>
      ))}
    </select>
  );
}
