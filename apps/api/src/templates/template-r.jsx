// Template R — 深酒红棕 + 玫瑰金 · 中央徽章式 · 16:9 横版 (1920×1080)
const R_TONE = {
  bg: '#1d1410',
  bgGlow: '#2a1c15',
  ink: '#f1e9d8',
  dim: 'rgba(241,233,216,0.55)',
  rule: 'rgba(241,233,216,0.14)',
  accent: '#c08e6a',  // 玫瑰金
};

const R_DEFAULT_SLOTS = {
  eyebrow: 'SCENE 01 · 第一秘',
  title: ['前三秒，是把人分流的暗门。'],
  titleAccent: '分流',
  subtitle: '',
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

function SlideR({ slots: rawSlots }) {
  const slots = { ...R_DEFAULT_SLOTS, ...rawSlots };
  const metrics = slots.metrics?.length ? slots.metrics : R_DEFAULT_SLOTS.metrics;
  const [m0, m1, m2] = [...metrics, ...R_DEFAULT_SLOTS.metrics].slice(0, 3);
  const t = R_TONE;

  const titleLines = Array.isArray(slots.title) ? slots.title : [slots.title];
  const renderTitle = (line) => {
    if (!slots.titleAccent || !line.includes(slots.titleAccent)) return line;
    const parts = line.split(slots.titleAccent);
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        {part}
        {i < parts.length - 1 && <span style={{ color: t.accent }}>{slots.titleAccent}</span>}
      </React.Fragment>
    ));
  };

  return (
    <div data-screen-label="R · Deep Wine" style={{
      width: 1920, height: 1080, background: t.bg, color: t.ink,
      position: 'relative', overflow: 'hidden',
      fontFamily: '"Noto Sans SC", system-ui, sans-serif',
    }}>
      {/* Centre warm glow */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(50% 60% at 50% 50%, ${t.bgGlow} 0%, ${t.bg} 70%)`,
      }} />

      {/* Top meta */}
      <div data-gsap="eyebrow" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 80px',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
        letterSpacing: '0.32em', color: t.accent, textTransform: 'uppercase',
      }}>
        <span>THE CUT · 剪辑笔记</span>
        <span>{slots.pageNum}</span>
      </div>

      {/* Centre eyebrow with rules */}
      <div data-gsap="eyebrow" style={{
        position: 'absolute', top: 110, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22,
        fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
        letterSpacing: '0.4em', color: t.accent, textTransform: 'uppercase',
      }}>
        <span style={{ width: 60, height: 1, background: t.accent }} />
        <span>{slots.eyebrow}</span>
        <span style={{ width: 60, height: 1, background: t.accent }} />
      </div>

      {/* Centre symmetric: left metrics · phone · right metrics */}
      <div style={{
        position: 'absolute', top: 200, bottom: 200, left: 80, right: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Left badge metrics */}
        <div data-gsap="metrics" style={{
          width: 380, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'flex-end',
        }}>
          {[m0, m1].map((m, i) => (
            <div key={i} style={{
              width: 360, padding: '24px 28px',
              border: `1px solid ${t.rule}`, borderRadius: 8,
              background: 'rgba(192,142,106,0.06)',
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                letterSpacing: '0.32em', color: t.dim, textTransform: 'uppercase',
              }}>0{i + 1} · {m.label}</div>
              <div style={{
                fontFamily: '"Noto Serif SC", serif', fontWeight: 500,
                fontSize: 56, lineHeight: 1,
              }}>{m.value}<span style={{ color: t.accent, fontSize: 24, marginLeft: 2 }}>{m.unit}</span></div>
            </div>
          ))}
        </div>

        {/* Centre phone */}
        <div data-gsap="phone" style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: -60,
            background: `radial-gradient(50% 50% at 50% 50%, ${t.accent}30 0%, transparent 70%)`,
            pointerEvents: 'none', filter: 'blur(10px)',
          }} />
          <window.PhonePreview
            width={300}
            accent={t.accent}
            tone="dark"
            rounded={42}
            handle={slots.hook?.handle}
            caption={slots.hook?.caption}
            hashtags={slots.hook?.hashtags}
            videoSrc={slots.hook?.videoSrc}
          />
        </div>

        {/* Right badge: big metric + hook */}
        <div data-gsap="metrics" style={{
          width: 380, display: 'flex', flexDirection: 'column', gap: 24,
        }}>
          <div style={{
            width: 360, padding: '24px 28px',
            border: `1px solid ${t.accent}`, borderRadius: 8,
            background: 'rgba(192,142,106,0.10)',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              letterSpacing: '0.32em', color: t.accent, textTransform: 'uppercase',
            }}>03 · {m2.label}</div>
            <div style={{
              fontFamily: '"Noto Serif SC", serif', fontWeight: 500,
              fontSize: 56, lineHeight: 1,
            }}>{m2.value}<span style={{ color: t.accent, fontSize: 24, marginLeft: 2 }}>{m2.unit}</span></div>
          </div>

          <div data-gsap="subtitle" style={{
            width: 360, padding: '20px 28px',
            borderLeft: `2px solid ${t.accent}`,
          }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
              letterSpacing: '0.32em', color: t.dim, textTransform: 'uppercase',
              marginBottom: 10,
            }}>HOOK · 开场白</div>
            <div style={{
              fontFamily: '"Noto Serif SC", serif', fontStyle: 'italic',
              fontSize: 18, lineHeight: 1.55, color: 'rgba(241,233,216,0.85)',
            }}>"<span style={{ color: t.accent, fontStyle: 'normal' }}>
              {slots.hook?.caption || R_DEFAULT_SLOTS.hook.caption}
            </span>"</div>
          </div>
        </div>
      </div>

      {/* Bottom title */}
      <div data-gsap="title" style={{
        position: 'absolute', bottom: 110, left: 80, right: 80,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: '"Noto Serif SC", serif', fontWeight: 900,
          fontSize: 80, lineHeight: 1.1, letterSpacing: '-0.01em',
        }}>
          {titleLines.map((line, i) => (
            <span key={i}>{renderTitle(line)}</span>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div data-gsap="progress" style={{
        position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)',
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
window.TemplateRegistry['R'] = {
  id: 'R', name: '深酒红棕徽章式', aspect: '16:9',
  size: { w: 1920, h: 1080 }, duration: 5,
  component: 'SlideR',
};
window.SlideR = SlideR;
