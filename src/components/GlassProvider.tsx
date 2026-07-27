import { useEffect, useRef } from 'react';
import { Glass } from '@samasante/liquid-glass';
import { initWebGLGlass, destroyWebGLGlass } from '../lib/webglGlass';

// webglGlass.ts fallback canvas params — same as main-station's
// main-station/src/lib/useUserGlassConfig.tsx DEFAULT_OPTICS.
const GLASS_OPTICS = {
  sheenWidth: 30,
  strength: 0.15,
  curvature: 0.15,
  frost: 3,
  dispersion: 0.10,
  brightness: 0.04,
};

// @samasante/liquid-glass per-element lens params — same as main-station's
// main-station/src/components/ToolSection.tsx optics prop.
export const CARD_OPTICS = {
  brightness: 0.06,
  sheen: 0.55,
  sheenWidth: 80,
  specular: 1.1,
  dispersion: 0.25,
  glow: 0.3,
  glowSpread: 0.18,
  depth: 0.7,
};

const API_BASE = 'https://api.oscarstudio.cn';
const DEFAULT_BG = `${API_BASE}/default-bg.jpeg`;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

type BgCfg = { url: string; overlay?: number; blur?: number };

// 把背景图放到 fixed 层而不是 body.style.backgroundImage，
// 这样 filter: blur 只影响背景，不会模糊前景内容。
// 遮罩是另一个 fixed 层（半透明黑色叠加）。
function applyBackgroundFx(cfg: BgCfg | null) {
  const body = document.body;
  const oldLayer = document.getElementById('userBgLayer');
  const oldMask = document.getElementById('userBgMask');
  if (oldLayer) oldLayer.remove();
  if (oldMask) oldMask.remove();
  body.style.backgroundImage = '';
  body.style.backgroundSize = '';
  body.style.backgroundPosition = '';
  body.style.backgroundRepeat = '';
  body.style.backgroundAttachment = '';

  if (!cfg) return;

  const overlay = typeof cfg.overlay === 'number' && Number.isFinite(cfg.overlay) ? cfg.overlay : 0;
  const blur = typeof cfg.blur === 'number' && Number.isFinite(cfg.blur) ? cfg.blur : 0;

  const layer = document.createElement('div');
  layer.id = 'userBgLayer';
  layer.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:-1',
    'pointer-events:none',
    `background-image:url(${cfg.url})`,
    'background-size:cover',
    'background-position:center',
    'background-repeat:no-repeat',
    'background-attachment:fixed',
    blur > 0 ? `filter:blur(${blur}px)` : '',
  ].filter(Boolean).join(';');
  document.body.appendChild(layer);

  if (overlay > 0) {
    const mask = document.createElement('div');
    mask.id = 'userBgMask';
    mask.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:-1',
      'pointer-events:none',
      'background:#000',
      `opacity:${overlay}`,
    ].join(';');
    document.body.appendChild(mask);
  }

  body.style.position = 'relative';
  body.style.isolation = 'isolate';
  body.style.background = 'transparent';
}

async function resolveBg(): Promise<BgCfg> {
  const fallback: BgCfg = { url: DEFAULT_BG };
  const token = readCookie('userToken');
  if (!token) return fallback;
  try {
    const resp = await fetch(`${API_BASE}/api/ui`, { credentials: 'include' });
    if (!resp.ok) return fallback;
    const data = await resp.json().catch(() => null);
    if (data?.success && data?.ui?.backgroundImage) {
      return {
        url: `${API_BASE}${data.ui.backgroundImage}`,
        overlay: data.ui.backgroundOverlay,
        blur: data.ui.backgroundBlur,
      };
    }
  } catch { /* ignore */ }
  return fallback;
}

function isChromium(): boolean {
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/CriOS|EdgiOS/.test(ua);
}

export function useGlassBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    document.body.classList.add('no-lg-refraction');

    const observer = new MutationObserver(() => {
      const bg = document.body.style.backgroundImage;
      if (!bg || bg === 'none') {
        resolveBg().then(cfg => {
          if (!document.body.style.backgroundImage || document.body.style.backgroundImage === 'none') {
            applyBackgroundFx(cfg);
          }
        });
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });

    resolveBg().then(applyBackgroundFx);

    if (!isChromium()) {
      const inst = initWebGLGlass(GLASS_OPTICS);
      if (!inst) {
        observer.disconnect();
        console.warn('WebGL fallback unavailable');
        return;
      }
      return () => {
        observer.disconnect();
        destroyWebGLGlass();
      };
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  if (canvasRef.current === null) {
    canvasRef.current = document.getElementById('lg-webgl-canvas') as HTMLCanvasElement | null;
  }
}

interface GlassWrapProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  borderRadius?: number;
}

export function GlassWrap({ children, className, style, borderRadius = 16 }: GlassWrapProps) {
  return (
    <Glass
      className={className}
      style={{ borderRadius, ...style }}
      optics={CARD_OPTICS}
    >
      {children}
    </Glass>
  );
}