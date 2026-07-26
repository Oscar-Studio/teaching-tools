import { useEffect, useRef } from 'react';
import { Glass } from '@samasante/liquid-glass';
import { initWebGLGlass, destroyWebGLGlass } from '../lib/webglGlass';

const GLASS_OPTICS = {
  sheenWidth: 60,
  strength: 0.4,
  curvature: 0.2,
  frost: 6,
  dispersion: 0.25,
  brightness: 0.18,
  depth: 0.7,
};

const DEFAULT_BG = 'https://api.oscarstudio.cn/default-bg.jpeg';

export function useGlassBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!document.body.style.backgroundImage) {
      document.body.style.backgroundImage = `url(${DEFAULT_BG})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
      document.body.style.backgroundAttachment = 'fixed';
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