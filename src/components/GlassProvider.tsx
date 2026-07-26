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

export function useGlassBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
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