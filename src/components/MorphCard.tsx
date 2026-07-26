import { useEffect, useState } from 'react';
import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Tool } from '../types';
import { GlassWrap } from './GlassProvider';

interface Props {
  tool: Tool | null;
  sourceRect: DOMRect | null;
  onClose: () => void;
}

const SPRING = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.8 };

export function MorphCard({ tool, sourceRect, onClose }: Props) {
  const lowQuality = typeof document !== 'undefined' && document.body.classList.contains('low-quality');
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tool) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tool, onClose]);

  const targetW = Math.min(450, viewport.w * 0.9);
  const targetH = 340;
  const targetX = (viewport.w - targetW) / 2;
  const targetY = (viewport.h - targetH) / 2;

  const initialX = sourceRect ? sourceRect.left : targetX;
  const initialY = sourceRect ? sourceRect.top : targetY;
  const initialW = sourceRect ? sourceRect.width : targetW;
  const initialH = sourceRect ? sourceRect.height : targetH;

  return (
    <AnimatePresence>
      {tool && (
        <>
          <motion.div
            key="backdrop"
            className={`backdrop ${tool ? 'active' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={lowQuality ? { duration: 0 } : { duration: 0.5 }}
            onClick={onClose}
          />
          <motion.div
            key="morph"
            className="morph-card"
            initial={{
              left: initialX,
              top: initialY,
              width: initialW,
              minHeight: initialH,
              opacity: 0.95,
            }}
            animate={{
              left: targetX,
              top: targetY,
              width: targetW,
              minHeight: targetH,
              opacity: 1,
            }}
            exit={{
              left: initialX,
              top: initialY,
              width: initialW,
              minHeight: initialH,
              opacity: 0.95,
            }}
            transition={lowQuality ? { duration: 0 } : SPRING}
          >
            <GlassWrap
              borderRadius={20}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(0, 229, 255, 0.4)',
                width: '100%',
                height: '100%',
                padding: '40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                position: 'relative',
              }}
            >
              <div style={{ fontSize: '4.5rem', marginBottom: 20 }}>{tool.icon || '📄'}</div>
              <h2 style={{ fontSize: '1.8rem', marginBottom: 15 }}>{tool.name}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1.7, marginBottom: 25 }}>
                {tool.description}
              </p>
              {tool.tags && tool.tags.length > 0 && (
                <div className="morph-tags" style={{ marginBottom: 20, justifyContent: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tool.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="morph-tag">{tag}</span>
                  ))}
                </div>
              )}
              <a
                href={tool.demoFile}
                className="btn-explore"
                style={{
                  display: 'inline-block',
                  padding: '12px 40px',
                  background: 'linear-gradient(135deg, var(--primary-color), var(--accent-color))',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: 25,
                  fontSize: '1rem',
                  fontWeight: 600,
                }}
              >
                进入演示
              </a>
              <button
                className="close-btn"
                type="button"
                onClick={onClose}
                style={{
                  position: 'absolute',
                  top: 15,
                  right: 15,
                  width: 32,
                  height: 32,
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'var(--text-muted)',
                  fontSize: '1.3rem',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </GlassWrap>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}