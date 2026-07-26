import { useEffect, useRef } from 'react';
import { Glass } from '@samasante/liquid-glass';
import { initWebGLGlass, destroyWebGLGlass } from '../lib/webglGlass';

const GLASS_OPTICS = {
  sheenWidth: 30,
  strength: 0.15,
  curvature: 0.15,
  frost: 3,
  dispersion: 0.10,
  brightness: 0.04,
};

const API_BASE = 'https://api.oscarstudio.cn';
const DEFAULT_BG = `${API_BASE}/default-bg.jpeg`;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function applyBackground(url: string) {
  const body = document.body;
  body.style.backgroundImage = `url(${url})`;
  body.style.backgroundSize = 'cover';
  body.style.backgroundPosition = 'center';
  body.style.backgroundRepeat = 'no-repeat';
  body.style.backgroundAttachment = 'fixed';
}

async function resolveBgUrl(): Promise<string> {
  const token = readCookie('userToken');
  if (!token) return DEFAULT_BG;
  try {
    const resp = await fetch(`${API_BASE}/api/ui`, { credentials: 'include' });
    if (!resp.ok) return DEFAULT_BG;
    const data = await resp.json().catch(() => null);
    if (data?.success && data?.ui?.backgroundImage) {
      return `${API_BASE}${data.ui.backgroundImage}`;
    }
  } catch { /* ignore */ }
  return DEFAULT_BG;
}

export function useGlassBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    document.body.classList.add('no-lg-refraction');

    const observer = new MutationObserver(() => {
      const bg = document.body.style.backgroundImage;
      if (!bg || bg === 'none') {
        resolveBgUrl().then(url => {
          if (!document.body.style.backgroundImage || document.body.style.backgroundImage === 'none') {
            applyBackground(url);
          }
        });
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });

    resolveBgUrl().then(applyBackground);

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
      optics={GLASS_OPTICS}
    >
      {children}
    </Glass>
  );
}