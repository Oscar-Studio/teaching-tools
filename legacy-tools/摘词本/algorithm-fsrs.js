// legacy-tools/摘词本/algorithm-fsrs.js
// FSRS 算法业务包装（_shared/fsrs-bundle.js 暴露 window.FsrsAlgorithm 为算法核心）
// 这里只做一层薄包装：把 window.FsrsAlgorithm 暴露为 window.FsrsAlgorithmWrapper。
//
// 使用方式：主 HTML 先加载 _shared/fsrs-bundle.js，再加载本文件。
(function () {
    'use strict';

    // 复习：传入 1/2/3/4 评级
    function review(word, ratingValue, settings) {
        return window.FsrsAlgorithm.review(word, ratingValue, settings);
    }

    // 学习：首次背诵也是一次 review
    function learn(word, ratingValue, settings) {
        return window.FsrsAlgorithm.review(word, ratingValue, settings);
    }

    // 暴露 wrapper
    window.FsrsAlgorithmWrapper = {
        review,
        learn,
        Rating: window.FsrsAlgorithm.Rating,
        State: window.FsrsAlgorithm.State,
        RatingLabels: window.FsrsAlgorithm.RatingLabels,
    };
})();
