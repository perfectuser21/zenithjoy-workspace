// Generic short-video phone preview. NOT TikTok-branded — neutral placeholder
// chrome with engagement counters, captions, and hashtags. Sized via prop.

function PhonePreview({
  width = 280,
  accent = '#e9c46a',
  tone = 'dark',
  caption = '"给所有宝妈说一句话……"',
  subCaption = '看这个开头是怎么抓住精准人群的',
  handle = '@精准案例',
  hashtags = ['#精准共鸣', '#宝妈'],
  likes = '3.2W',
  comments = '1.9K',
  stars = '1.4W',
  posterFill = null,
  posterLabel = '短视频画面',
  showStatusBar = true,
  rounded = 38,
  videoSrc = null,
}) {
  const h = Math.round(width * (812 / 375));
  const isLight = tone === 'light';
  const bezel = isLight ? '#222' : '#111';
  const screenBg = isLight ? '#f5f4f0' : '#0a0a0a';
  const fg = isLight ? '#111' : '#fff';
  const sub = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';

  return (
    <div style={{
      width, height: h, borderRadius: rounded, padding: 6,
      background: `linear-gradient(160deg, ${bezel} 0%, #000 100%)`,
      boxShadow: '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 2px 0 rgba(255,255,255,0.06) inset',
      position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: rounded - 6,
        background: screenBg, overflow: 'hidden', position: 'relative',
        color: fg, fontFamily: '"Noto Sans SC", system-ui, sans-serif',
      }}>
        {/* Dynamic island */}
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          width: 90, height: 26, borderRadius: 14, background: '#000', zIndex: 5,
        }} />

        {/* Status bar */}
        {showStatusBar && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 22px', fontSize: 13, fontWeight: 600, zIndex: 4, color: fg,
          }}>
            <span style={{ fontFamily: 'SF Pro, system-ui' }}>9:41</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <div style={{ width: 16, height: 10, border: `1.2px solid ${fg}`, borderRadius: 2, opacity: 0.9 }} />
            </div>
          </div>
        )}

        {/* Video / poster area — video is overlaid by FFmpeg post-processing, not rendered in browser */}
        <div style={{
          position: 'absolute', inset: 0,
          background: videoSrc ? '#000000' : (posterFill || `repeating-linear-gradient(
              135deg,
              ${isLight ? '#e8e4dc' : '#1a1a18'} 0px,
              ${isLight ? '#e8e4dc' : '#1a1a18'} 8px,
              ${isLight ? '#dfd9cc' : '#13130f'} 8px,
              ${isLight ? '#dfd9cc' : '#13130f'} 16px
            )`),
          backgroundSize: 'cover', backgroundPosition: 'center',
          zIndex: 1,
        }}>
          {!videoSrc && !posterFill && <div style={{
            position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%, -50%)',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.15em',
            color: isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
          }}>{posterLabel}</div>}
        </div>

        {/* Right rail icons */}
        <div style={{
          position: 'absolute', right: 14, bottom: 140, display: 'flex',
          flexDirection: 'column', gap: 22, alignItems: 'center', zIndex: 3,
        }}>
          {[
            { ic: '♥', n: likes, c: '#ff4e6a' },
            { ic: '◐', n: comments, c: fg },
            { ic: '★', n: stars, c: fg },
          ].map((x, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 20,
                background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center',
                color: x.c, fontSize: 20,
              }}>{x.ic}</div>
              <div style={{ fontSize: 11, color: fg, opacity: 0.92 }}>{x.n}</div>
            </div>
          ))}
        </div>

        {/* Bottom caption */}
        <div style={{
          position: 'absolute', left: 16, right: 70, bottom: 30, zIndex: 3,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            {handle}
            <span style={{
              width: 14, height: 14, borderRadius: 7, background: accent,
              color: '#000', fontSize: 9, display: 'grid', placeItems: 'center', fontWeight: 800,
            }}>✓</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: fg, opacity: 0.95 }}>
            {caption}
            <br />{subCaption}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: accent, marginTop: 2 }}>
            {hashtags.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>

        {/* Home indicator */}
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          width: 130, height: 4, borderRadius: 2, background: fg, opacity: 0.65, zIndex: 5,
        }} />
      </div>
    </div>
  );
}

window.PhonePreview = PhonePreview;
