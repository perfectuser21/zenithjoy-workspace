interface Template {
  id: string;
  name: string;
  aspect: '9:16' | '16:9';
  emoji: string;
}

const TEMPLATES: Template[] = [
  { id: 'W-G', name: '竖版 · Bauhaus', aspect: '9:16', emoji: '🎨' },
  { id: 'C',   name: '横版 · 克制',   aspect: '16:9', emoji: '🖤' },
  { id: 'R',   name: '横版 · 深色',   aspect: '16:9', emoji: '🍷' },
];

interface TemplateSelectorProps {
  value: string | null;
  onChange: (id: string | null) => void;
}

export default function TemplateSelector({ value, onChange }: TemplateSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">视频模板（可选）</div>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
            value === null
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
          }`}
        >
          不使用模板
        </button>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${
              value === t.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
            }`}
          >
            <span className="mr-1">{t.emoji}</span>
            <span className="font-medium">{t.id}</span>
            <span className="ml-1 text-xs text-slate-400">{t.name}</span>
            <span className="ml-1 text-xs text-slate-300 hidden sm:inline">[{t.aspect}]</span>
          </button>
        ))}
      </div>
    </div>
  );
}
