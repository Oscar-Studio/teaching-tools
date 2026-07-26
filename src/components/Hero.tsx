import { GlassWrap } from './GlassProvider';

export function Hero() {
  return (
    <section className="hero">
      <GlassWrap
        borderRadius={24}
        style={{
          padding: '40px 60px',
          background: 'transparent',
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div className="hero-icon">📚</div>
        <h1>教学工具</h1>
      </GlassWrap>
      <p>
        丰富的 HTML 演示工具，专为教师和学生设计。包含函数图像绘制、几何图形演示、化学方程式配平、计时器、抽签器等多种实用工具，让抽象的知识变得直观可见，使课堂教学更加生动有趣，提升学习效率。
      </p>
    </section>
  );
}