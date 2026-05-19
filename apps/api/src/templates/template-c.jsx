// Template C — 克制纪录片 · 黑底暖黄 · 16:9 横版 (1920×1080)
const C_TONE = {
  bg: '#0a0a0a',
  ink: '#f0ede5',
  dim: 'rgba(240,237,229,0.5)',
  rule: 'rgba(240,237,229,0.12)',
  amber: '#c9a23d',
};

const C_DEFAULT_SLOTS = {
  eyebrow: 'CASE STUDY / 第一秘 · 精准共鸣',
  title: ['前三秒，', '是把人分流的暗门。'],
  titleAccent: '分流',
  subtitle: '一句开场白，决定算法把这条片送给谁 —— 也决定哪一群人会停下来看完。',
  metrics: [
    { label: '互动率', value: '3.2', unit: '×' },
    { label: '完播率', value: '+68', unit: '%' },
    { label: '精准曝光', value: '91', unit: '%' },
  ],
  hook: {
    handle: '@精准案例',
    caption: '给所有宝妈说一句话……',
    hashtags: [],
    videoSrc: '',
  },
  pageNum: '03 / 08',
};

function SlideC({ slots: rawSlots }) {
  const slots = { ...C_DEFAULT_SLOTS, ...rawSlots };
  const metrics = slots.metrics?.length ? slots.metrics : C_DEFAULT_SLOTS.metrics;
  const t = C_TONE;

  // Build title with accent highlight
  const titleLines = Array.isArray(slots.title) ? slots.title : [slots.title];
  const renderTitle = (line) => {
    if (!slots.titleAccent || !line.includes(slots.titleAccent)) return line;
    const parts = line.split(slots.titleAccent);
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        {part}
        {i < parts.length - 1 && <span style={{ color: t.amber }}>{slots.titleAccent}</span>}
      </React.Fragment>
    ));
  };

  return (
    <div data-screen-label="C · 克制纪录片" style={{
      width: 1920, height: 1080, background: t.bg, color: t.ink,
      position: 'relative', overflow: 'hidden',
      fontFamily: '"Noto Sans SC", system-ui, sans-serif',
    }}>
      {/* Meta strip */}
      <div data-gsap="eyebrow" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 60px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 13,
        letterSpacing: '0.32em', color: t.amber,
      }}>
        <span>{slots.eyebrow}</span>
        <span>{slots.pageNum}</span>
      </div>

      {/* Phone */}
      <div data-gsap="phone" style={{
        position: 'absolute', left: 60, top: 100, width: 620, bottom: 110,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <window.PhonePreview
          width={340}
          accent={t.amber}
          tone="dark"
          rounded={42}
          handle={slots.hook?.handle}
          caption={slots.hook?.caption}
          hashtags={slots.hook?.hashtags}
          videoSrc={slots.hook?.videoSrc}
        />
      </div>

      {/* Right panel */}
      <div style={{ position: 'absolute', left: 760, top: 280, right: 80 }}>
        {/* Eyebrow label */}
        <div data-gsap="eyebrow" style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 16,
          letterSpacing: '0.32em', color: t.amber,
          textTransform: 'uppercase', marginBottom: 28,
        }}>SCENE 01 / 精准共鸣点</div>

        {/* Title */}
        <div data-gsap="title" style={{
          fontFamily: '"Noto Serif SC", serif', fontWeight: 900,
          fontSize: 116, lineHeight: 1.1, letterSpacing: '-0.01em',
        }}>
          {titleLines.map((line, i) => (
            <div key={i}>{renderTitle(line)}</div>
          ))}
        </div>

        {/* Subtitle */}
        {slots.subtitle && (
          <div data-gsap="subtitle" style={{
            marginTop: 30, fontSize: 19, lineHeight: 1.65,
            color: 'rgba(240,237,229,0.65)', maxWidth: 880,
          }}>
            {slots.subtitle}
          </div>
        )}

        {/* Metrics */}
        <div data-gsap="metrics" style={{
          marginTop: 70, paddingTop: 26,
          borderTop: `1px solid ${t.rule}`,
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        }}>
          {metrics.map((m, i) => (
            <div key={i} style={{
              paddingRight: 30,
              borderRight: i < 2 ? `1px solid ${t.rule}` : 'none',
              paddingLeft: i > 0 ? 30 : 0,
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                letterSpacing: '0.3em', color: t.dim, textTransform: 'uppercase',
              }}>0{i + 1} · {m.label}</div>
              <div style={{
                marginTop: 8, fontFamily: '"Noto Serif SC", serif',
                fontWeight: 500, fontSize: 60, lineHeight: 1, color: t.ink,
              }}>
                {m.value}<span style={{ color: t.amber, fontSize: 28, marginLeft: 4 }}>{m.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div data-gsap="progress" style={{
        position: 'absolute', bottom: 50, right: 60,
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            width: i === 2 ? 32 : 22, height: 2,
            background: i === 2 ? t.ink : t.rule,
          }} />
        ))}
      </div>
    </div>
  );
}

window.TemplateRegistry = window.TemplateRegistry || {};
window.TemplateRegistry['C'] = {
  id: 'C', name: '克制纪录片', aspect: '16:9',
  size: { w: 1920, h: 1080 }, duration: 5,
  component: 'SlideC',
};
window.SlideC = SlideC;
