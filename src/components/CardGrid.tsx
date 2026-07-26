import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Tool } from '../types';

interface Props {
  tools: Tool[];
  loading: boolean;
  error: string | null;
  onSelect: (tool: Tool, rect: DOMRect) => void;
}

const SUBJECT_NAMES: Record<string, string> = {
  '数学': '数学',
  '物理': '物理',
  '化学': '化学',
  '生物': '生物',
  '语文': '语文',
  '英语': '英语',
  '地理': '地理',
  '历史': '历史',
  '道法': '道法',
  '通用': '通用工具',
};

export function CardGrid({ tools, loading, error, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return <main className="card-container"><p className="no-results">加载中…</p></main>;
  }
  if (error) {
    return <main className="card-container"><p className="no-results">{error}</p></main>;
  }
  if (tools.length === 0) {
    return <main className="card-container"><p className="no-results">没有找到匹配的工具</p></main>;
  }

  const grouped: Record<string, Tool[]> = {};
  tools.forEach(tool => {
    const subject = (tool.subject && tool.subject[0]) || '通用';
    if (!grouped[subject]) grouped[subject] = [];
    grouped[subject].push(tool);
  });

  const subjects = Object.keys(grouped).sort(
    (a, b) => grouped[b].length - grouped[a].length,
  );

  return (
    <main className="card-container" id="cardContainer" ref={containerRef}>
      {subjects.map(subject => (
        <section key={subject} className="category-section">
          <h2 className="category-title">{SUBJECT_NAMES[subject] || subject}</h2>
          <div className="category-grid">
            <AnimatePresence>
              {grouped[subject].map((tool, idx) => (
                <motion.div
                  key={tool.id}
                  className="card glass-element"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onSelect(tool, rect);
                  }}
                  whileHover={{ y: -4, scale: 1.02 }}
                >
                  <div className="card-header">
                    <span className="card-icon">{tool.icon || '📄'}</span>
                    <span className="card-name">{tool.name}</span>
                  </div>
                  {tool.tags && tool.tags.length > 0 && (
                    <div className="card-tags">
                      {tool.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="card-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
    </main>
  );
}