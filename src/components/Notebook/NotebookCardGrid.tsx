import type { Tool } from '../../types';
import { SUBJECT_NAMES, groupToolsBySubject } from '../../lib/subjects';

interface Props {
  tools: Tool[];
}

/**
 * Notebook 风卡片网格 —— 一页一页翻，按学科分章：
 *   - 8px 圆角 + 1px hairline
 *   - 右上小页码角标（mono 字体，全局连续编号）
 *   - 左上 tag 药丸（珊瑚 accent）
 *   - hover 时 accent 接管边框 + -1px 上移
 *   - 每个学科一个 <section>，标题沿用 Notebook 的 eyebrow + 衬线
 *   - 点击直接跳转（<a href>），不用 MorphCard 开启动画
 */
export function NotebookCardGrid({ tools }: Props) {
  const totalPages = tools.length;
  const { grouped, order: subjects } = groupToolsBySubject(tools);

  // 全局页码：跨学科连续计数（与 NotebookHero "PAGE 01 / 17" 对齐）
  let globalIdx = 0;

  return (
    <section className="notebook-grid" id="notebookGrid">
      <div className="notebook-grid__inner">
        {subjects.map((subject) => {
          const subjectName = SUBJECT_NAMES[subject] || subject;
          return (
            <div key={subject} className="notebook-grid__group">
              <header className="notebook-grid__group-head">
                <p className="eyebrow">CHAPTER · {subject.toUpperCase()}</p>
                <h2 className="notebook-grid__group-title">{subjectName}</h2>
              </header>
              <div className="notebook-grid__list">
                {grouped[subject].map((tool) => {
                  const i = globalIdx++;
                  const pageNum = String(i + 1).padStart(2, '0');
                  const pageTotal = String(totalPages).padStart(2, '0');
                  return (
                    <a
                      key={tool.id}
                      href={tool.demoFile}
                      data-cursor="hover"
                      className="notebook-card"
                    >
                      <div className="notebook-card__head">
                        {tool.tags?.[0] && (
                          <span className="notebook-card__tag">{tool.tags[0]}</span>
                        )}
                        {tool.icon && <span className="notebook-card__icon">{tool.icon}</span>}
                      </div>
                      <h3 className="notebook-card__name">{tool.name}</h3>
                      {tool.description && (
                        <p className="notebook-card__desc">{tool.description}</p>
                      )}
                      <span className="notebook-card__page" aria-hidden="true">
                        p.<span className="notebook-card__page-num">{pageNum}</span>
                        <span className="notebook-card__page-total">/{pageTotal}</span>
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
