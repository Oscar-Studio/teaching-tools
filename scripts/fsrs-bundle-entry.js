// scripts/fsrs-bundle-entry.js
// 打包入口：把 ts-fsrs + FSRS 算法业务逻辑打成一个 IIFE 文件，
// 输出到 legacy-tools/摘词本/_shared/fsrs-bundle.js
//
// 不依赖 React/Vite，可在任何现代浏览器直接 <script src="_shared/fsrs-bundle.js"></script> 加载。
import { fsrs, Rating, State, generatorParameters, createEmptyCard } from 'ts-fsrs';

(function () {
    'use strict';

    // ----- FSRS 配置 -----
    function createFsrsInstance(desiredRetention) {
        const r = Math.max(0.8, Math.min(0.95, Number(desiredRetention) || 0.9));
        return fsrs(generatorParameters({
            enable_fuzz: true,           // 启用间隔随机化，避免同日堆积
            enable_short_term: false,    // 摘词本一天打开一次，关闭短间隔学习阶段
            request_retention: r,
            maximum_interval: 36500,     // 100 年上限
        }));
    }

    // ----- 后端 word → FSRS card -----
    function wordToCard(word, now) {
        return {
            due: word.next_review ? new Date(word.next_review) : now,
            stability: typeof word.stability === 'number' ? word.stability : 0,
            difficulty: typeof word.difficulty === 'number' ? word.difficulty : 0,
            elapsed_days: 0,
            scheduled_days: 0,
            learning_steps: 0,
            reps: word.review_count || word.reps || 0,
            lapses: word.lapses || 0,
            state: (typeof word.fsrs_state === 'number') ? word.fsrs_state : State.New,
            last_review: word.last_review ? new Date(word.last_review) : undefined,
        };
    }

    // ----- 评分映射 -----
    const RATING_MAP = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };

    // ----- 主接口：复习一个词 -----
    // word: { id, status, review_count, last_review, next_review, difficulty, stability, fsrs_state, lapses }
    // ratingValue: 1 | 2 | 3 | 4
    // settings: { desiredRetention, requiredReviews }
    function reviewWord(word, ratingValue, settings) {
        const algo = createFsrsInstance(settings.desiredRetention);
        const now = new Date();
        const card = wordToCard(word, now);
        const rating = RATING_MAP[ratingValue] || Rating.Good;
        const result = algo.next(card, now, rating);
        const c = result.card;

        // FSRS mastered 自动判定：稳定性 ≥ 365 天（约 1 年长期记忆）即视为掌握
        // 不依赖复习次数——FSRS 的核心是 stability 自适应，S 反映"记忆能持续多久"，
        // 比"复习 N 次"更准确。简单词可能 5 次 S 就到 365，困难词可能要 10+ 次。
        const MASTERED_STABILITY = 365;
        let status;
        if (c.state === State.New) {
            status = 'new';
        } else if (c.state === State.Review && c.stability >= MASTERED_STABILITY) {
            status = 'mastered';
        } else {
            status = 'learning';
        }

        return {
            status,
            review_count: c.reps,
            last_review: now.toISOString(),
            next_review: c.due.toISOString(),
            difficulty: c.difficulty,
            stability: c.stability,
            fsrs_state: c.state,
            lapses: c.lapses,
        };
    }

    // ----- 旧数据 → FSRS 初始化 -----
    function initFromLegacy(word) {
        const now = new Date();
        if (!word.status || word.status === 'new' || (word.review_count || 0) === 0) {
            const card = createEmptyCard(now);
            return {
                difficulty: card.difficulty,
                stability: card.stability,
                fsrs_state: card.state,
                lapses: 0,
                review_count: 0,
            };
        }
        const count = word.review_count || 1;
        return {
            difficulty: 5,
            stability: count * 2,
            fsrs_state: State.Review,
            lapses: 0,
            review_count: count,
        };
    }

    // ----- 暴露到全局 -----
    window.FsrsAlgorithm = {
        review: reviewWord,
        initFromLegacy,
        Rating,
        State,
        RatingLabels: { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' },
    };
})();
