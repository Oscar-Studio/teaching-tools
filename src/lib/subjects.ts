import type { Tool } from '../types';

/** 学科代码 → 中文显示名。Notebook / Classic 两个主题共用，避免漂移。 */
export const SUBJECT_NAMES: Record<string, string> = {
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

/** 未声明学科或学科数组为空 → "通用"。 */
export const FALLBACK_SUBJECT = '通用';

/**
 * 把工具按 `subject[0]` 分组。返回值：
 *   - grouped: { 学科代码: Tool[] }（保持输入顺序）
 *   - order: 按"工具数量从多到少"排序的学科代码列表
 */
export function groupToolsBySubject(tools: Tool[]): {
  grouped: Record<string, Tool[]>;
  order: string[];
} {
  const grouped: Record<string, Tool[]> = {};
  for (const tool of tools) {
    const subject = tool.subject?.[0] || FALLBACK_SUBJECT;
    if (!grouped[subject]) grouped[subject] = [];
    grouped[subject].push(tool);
  }
  const order = Object.keys(grouped).sort(
    (a, b) => grouped[b].length - grouped[a].length,
  );
  return { grouped, order };
}
