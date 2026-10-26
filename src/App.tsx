import { useState } from 'react';
import { TopBar } from './components/TopBar';
import { NotebookLanding } from './components/Notebook/NotebookLanding';
import { useToolsConfig } from './hooks/useToolsConfig';

export default function App() {
  const { tools, loading, error } = useToolsConfig();
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLocaleLowerCase();
  const results = tools.filter(tool => [tool.name, tool.description, ...(tool.tags || [])].join(' ').toLocaleLowerCase().includes(keyword));
  return <>
    <TopBar section="教学工具" onSearch={setQuery} />
    <NotebookLanding tools={results} />
    {(loading || error || (keyword && !results.length)) && <p className="landing-status" role="status">{loading ? '正在加载…' : error ? '加载失败，请刷新重试。' : '暂时没有匹配的内容，试试其他关键词。'}</p>}
  </>;
}
