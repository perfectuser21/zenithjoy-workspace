// W-G · Bauhaus 撞色 · 大胆纯色块拼贴 · 竖版 9:16
// Parameterized template — pass `slots` prop to override content.
// All animatable elements carry data-gsap="..." attributes.

const SAFE_X_T2 = 108;
const SAFE_TOP_T2 = 192;
const SAFE_BOTTOM_T2 = 384;

const DEFAULT_SLOTS = {
  eyebrow: 'SCENE 01 · 精准共鸣点',
  title: ['前三秒，', '把人分流'],
  titleAccent: '分流',
  subtitle: '一句开场白决定算法把这条片送给谁。',
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
  pageNum: '01 / 01',
};

const WG_TONE = {
  bg: '#ede4d2',
  stripe: '#1f3a3d',
  ink: '#1a1410',
  light: '#ede4d2',
  mustard: '#d39c4a',
  dim: 'rgba(26,20,16,0.55)',
  rule: 'rgba(26,20,16,0.18)',
  ruleLight: 'rgba(237,228,210,0.22)',
};

function buildProgressWG(t) {
  return (
    <div
      data-gsap="progress"
      style={{
        position: 'absolute',
        left: SAFE_X_T2,
        right: SAFE_X_T2,
        top: 1920 - SAFE_BOTTOM_T2 - 10,
        height: 10,
        display: 'flex',
        gap: 10,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === 2 ? 32 : 22,
            height: 2,
            background: i === 2 ? t.ink : t.rule,
          }}
        />
      ))}
    </div>
  );
}

function SlideWG({ slots: rawSlots }) {
  const slots = rawSlots || DEFAULT_SLOTS;
  const t = WG_TONE;

  // Resolve title lines — supports string or array
  const titleLines = Array.isArray(slots.title) ? slots.title : [slots.title];
  const titleAccent = slots.titleAccent || DEFAULT_SLOTS.titleAccent;

  // Big metric (3rd metric = index 2, displayed as hero number in stripe)
  const metrics = slots.metrics || DEFAULT_SLOTS.metrics;
  const bigMetric = metrics[2] || metrics[0];
  const smallMetrics = metrics.slice(0, 2);

  const hook = slots.hook || DEFAULT_SLOTS.hook;

  return (
    <div
      data-screen-label="W-G · Vertical Stripe"
      style={{
        width: 1080,
        height: 1920,
        background: t.bg,
        color: t.ink,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
      }}
    >
      {/* Cream watermark — big serif "精准" at faint stroke */}
      <div style={{
        position: 'absolute', left: 480, top: 80, pointerEvents: 'none',
        fontFamily: '"Noto Serif SC", serif', fontWeight: 900,
        fontSize: 520, lineHeight: 0.88, letterSpacing: '0.02em',
        color: 'transparent', WebkitTextStroke: '2px rgba(26,20,16,0.08)',
      }}>精准</div>

      {/* Faint dot grid in cream area */}
      <div style={{
        position: 'absolute', left: 440, top: 0, right: 0, bottom: 0,
        opacity: 0.18, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(26,20,16,0.45) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Small vertical mono tag on cream */}
      <div style={{
        position: 'absolute', right: 30, top: 240,
        writingMode: 'vertical-rl', pointerEvents: 'none',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
        letterSpacing: '0.4em', color: 'rgba(26,20,16,0.20)',
        textTransform: 'uppercase',
      }}>SECRET 01 · PRECISION RESONANCE</div>

      {/* Left stripe — bleeds full-height */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 440,
        background: t.stripe, color: t.light,
      }} />

      {/* Eyebrow + page num — top right meta row */}
      <div
        data-gsap="eyebrow"
        style={{
          position: 'absolute',
          left: 500,
          right: 80,
          top: SAFE_TOP_T2 - 60,
          height: 40,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 22,
          letterSpacing: '0.3em',
          color: t.ink,
          textTransform: 'uppercase',
        }}
      >
        <span>{slots.eyebrow}</span>
        <span>{slots.pageNum}</span>
      </div>

      {/* Phone — top, fits within stripe + cream split */}
      <div
        data-gsap="phone"
        style={{
          position: 'absolute', left: 160, top: 230, zIndex: 4,
          filter: 'drop-shadow(0 36px 60px rgba(0,0,0,0.45))',
        }}
      >
        <window.PhonePreview
          width={400}
          accent={t.mustard}
          tone="dark"
          rounded={50}
          handle={hook.handle}
          caption={hook.caption}
          hashtags={hook.hashtags}
          posterFill={hook.videoSrc ? `url(${hook.videoSrc})` : null}
        />
      </div>

      {/* Big title — right side, below phone */}
      <div
        data-gsap="title"
        style={{
          position: 'absolute', left: 520, right: 80, top: 1080, zIndex: 3,
        }}
      >
        {/* Eyebrow label above title */}
        <div
          data-gsap="eyebrow"
          style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 20,
            letterSpacing: '0.4em', color: t.mustard, textTransform: 'uppercase',
            marginBottom: 24,
          }}
        >
          {slots.eyebrow.split('·')[0].trim()}
        </div>

        {/* Title lines with accent on last word matching titleAccent */}
        <div style={{
          fontFamily: '"Noto Serif SC", serif', fontWeight: 900,
          fontSize: 96, lineHeight: 1.12, letterSpacing: '-0.005em',
        }}>
          {titleLines.map((line, idx) => {
            if (titleAccent && line.includes(titleAccent)) {
              const parts = line.split(titleAccent);
              return (
                <div key={idx}>
                  {parts[0]}
                  <span style={{ color: t.mustard }}>{titleAccent}</span>
                  {parts[1]}
                  {idx < titleLines.length - 1 ? null : null}
                </div>
              );
            }
            return <div key={idx}>{line}</div>;
          })}
        </div>

        {/* Subtitle */}
        <div
          data-gsap="subtitle"
          style={{
            marginTop: 32,
            paddingTop: 22,
            borderTop: `1px solid ${t.rule}`,
            fontFamily: '"Noto Serif SC", serif',
            fontSize: 22,
            lineHeight: 1.6,
            color: t.dim,
            fontStyle: 'italic',
          }}
        >
          {slots.subtitle}
        </div>
      </div>

      {/* Big hero metric inside stripe */}
      <div
        data-gsap="metric-big"
        style={{
          position: 'absolute', left: 60, top: 1280,
          width: 380, color: t.light, zIndex: 5,
        }}
      >
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 18,
          letterSpacing: '0.36em', color: t.mustard, textTransform: 'uppercase',
          marginBottom: 18,
        }}>PRECISION</div>
        <div style={{
          fontFamily: '"Noto Serif SC", serif', fontWeight: 900,
          fontSize: 240, lineHeight: 0.85, letterSpacing: '-0.06em',
        }}>
          {bigMetric.value}
          <span style={{ fontSize: 96 }}>{bigMetric.unit}</span>
        </div>
        <div style={{
          marginTop: 18, fontSize: 19,
          color: 'rgba(237,228,210,0.7)',
        }}>{bigMetric.label}</div>
      </div>

      {/* Bottom metrics row on cream */}
      <div
        data-gsap="metrics"
        style={{
          position: 'absolute', left: 500, right: 80,
          bottom: 240, zIndex: 3,
          paddingTop: 26, borderTop: `2px solid ${t.ink}`,
          display: 'grid', gridTemplateColumns: '1fr 1fr',
        }}
      >
        {smallMetrics.map((m, i) => (
          <div key={i} style={{
            paddingRight: 14,
            borderRight: i < smallMetrics.length - 1 ? `1px solid ${t.rule}` : 'none',
            paddingLeft: i > 0 ? 26 : 0,
          }}>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 19,
              letterSpacing: '0.3em', color: t.dim, textTransform: 'uppercase',
            }}>0{i + 1} · {m.label}</div>
            <div style={{
              marginTop: 6, fontFamily: '"Noto Serif SC", serif',
              fontWeight: 500, fontSize: 76, lineHeight: 1,
            }}>
              {m.value}
              <span style={{ color: t.mustard, fontSize: 34, marginLeft: 2 }}>{m.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {buildProgressWG(t)}
    </div>
  );
}

// ── Template Registry ──────────────────────────────────────────────────────────
window.TemplateRegistry = window.TemplateRegistry || {};
window.TemplateRegistry['W-G'] = {
  id: 'W-G',
  name: '竖版 · Bauhaus 撞色',
  aspect: '9:16',
  size: { w: 1080, h: 1920 },
  duration: 5,
  component: 'SlideWG',
};
window.SlideWG = SlideWG;
