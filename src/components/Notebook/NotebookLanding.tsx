import { BackgroundCover } from '../BackgroundCover';
import type { Tool } from '../../types';
import { NotebookHero } from './NotebookHero';
import { NotebookCardGrid } from './NotebookCardGrid';

interface Props {
  tools: Tool[];
}

/**
 * Notebook 主题的整体落地页包装：
 *   - hero + 卡片网格（直接跳转，无 MorphCard 动画）
 */
export function NotebookLanding({ tools }: Props) {
  return (
    <div className="notebook-landing">
      <BackgroundCover variant="edu" label="02 / NOTEBOOK — 知识之外，也有风景。"><NotebookHero total={tools.length} /></BackgroundCover>
      <NotebookCardGrid tools={tools} />
    </div>
  );
}
