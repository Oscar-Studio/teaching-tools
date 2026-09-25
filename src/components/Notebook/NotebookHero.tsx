/**
 * Notebook 风 hero —— 横纹纸 + 衬线大标题 + 珊瑚 accent：
 *   - 背景是横纹纸纹理（CSS variable 控制）
 *   - 左侧 eyebrow + 衬线大标题 + lede
 *   - 右下角"页码"装饰
 *   - 字体：标题 Noto Serif SC（衬线），正文 Inter，页码 mono
 */
interface Props {
  total?: number;
}

export function NotebookHero({ total }: Props = {}) {
  // 默认 17 保留旧视觉，但实际部署会从 NotebookLanding 传入 tools.length
  const totalPages = total ?? 17;
  const pageTotal = String(totalPages).padStart(2, '0');
  return (
    <section className="notebook-hero" id="heroSection">
      <div className="notebook-hero__inner">
        <div className="notebook-intro">
          <div className="notebook-intro__left">
            <p className="eyebrow">教学工具 · NOTEBOOK</p>
            <h1>
              Page by <em>page.</em>
            </h1>
            <p className="notebook-intro__lede">
              一页一页，慢慢学会。函数图像、几何演示、化学配平、计时器 —
              一组适合课堂与自学的 HTML 工具，让抽象的知识变得直观可见。
            </p>
          </div>

          <div className="notebook-intro__page" aria-hidden="true">
            <span className="notebook-intro__page-label">PAGE</span>
            <span className="notebook-intro__page-num">01 / {pageTotal}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
