import { useRef, useState, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { Hero } from './components/Hero';
import { CardGrid } from './components/CardGrid';
import { MorphCard } from './components/MorphCard';
import { useToolsConfig } from './hooks/useToolsConfig';
import { useOpilot } from './hooks/useOpilot';
import { useGlassBackground } from './components/GlassProvider';
import type { Tool } from './types';

export default function App() {
  useGlassBackground();
  const { tools, loading, error } = useToolsConfig();
  const [selected, setSelected] = useState<{ tool: Tool; rect: DOMRect } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useOpilot(searchInputRef.current, tools, 'edu');

  const handleSelect = useCallback((tool: Tool, rect: DOMRect) => {
    setSelected({ tool, rect });
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
  }, []);

  return (
    <>
      <TopBar />
      <Hero />
      <CardGrid
        tools={tools}
        loading={loading}
        error={error}
        onSelect={handleSelect}
      />
      <MorphCard
        tool={selected?.tool ?? null}
        sourceRect={selected?.rect ?? null}
        onClose={handleClose}
      />
    </>
  );
}