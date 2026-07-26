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

function isChromium(): boolean {
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/CriOS|EdgiOS/.test(ua);
}

export function useGlassBackground() {
  const useWebGL = !isChromium();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!useWebGL) {
      document.body.classList.add('no-lg-refraction');
      return;
    }
    document.body.classList.add('no-lg-refraction');
    const inst = initWebGLGlass(GLASS_OPTICS);
    if (!inst) {
      console.warn('WebGL fallback unavailable');
      return;
    }
    return () => {
      destroyWebGLGlass();
    };
  }, [useWebGL]);

  if (useWebGL && canvasRef.current === null) {
    canvasRef.current = document.getElementById('liquid-glass-canvas') as HTMLCanvasElement | null;
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