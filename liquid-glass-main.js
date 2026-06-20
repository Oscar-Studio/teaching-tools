/* ================================================================
 *  liquid-glass-main.js
 *  WebGL 液态玻璃 shader（prabin SDF 思路，扩展为多矩形 / 单矩形预览）
 *
 *  - 自动初始化：如果页面有 #liquid-glass-canvas
 *  - 默认 scope = 整个 document，扫描所有 .glass-element
 *  - 页面可指定 scope（如 settings 预览只扫预览区内的玻璃元素）
 *  - 公开 API：window.LiquidGlass.init / setQuality / setParams / getParams / setBg / refresh
 *  - 背景纹理：从 body.style.backgroundImage 或 setBg(url) 注入
 * ================================================================ */
(function () {
    'use strict';

    const MAX_RECTS = 16;

    const QUALITY_PRESETS = {
        high: { edge: 80, refr: 80, curve: 2.0, frost: 0.0, ca: 18, alpha: 0.18 },
        mid:  { edge: 60, refr: 60, curve: 2.0, frost: 0.0, ca: 0,  alpha: 0.15 },
        low:  { edge: 0,  refr: 0,  curve: 0,   frost: 0.0, ca: 0,  alpha: 0    },
    };

    const DEFAULT_PARAMS = { ...QUALITY_PRESETS.high };

    // ============ 入口 ============
    function autoInit() {
        const canvas = document.getElementById('liquid-glass-canvas');
        if (!canvas) return;
        const scope = canvas.getAttribute('data-lg-scope') || null;
        const bgUrl = canvas.getAttribute('data-lg-bg') || null;
        const cardSelector = canvas.getAttribute('data-lg-card-selector') || null;
        // 若 canvas 上有 data-lg-scope，让页面 JS 自己 init（带 bgImageUrl），我们不抢先
        if (scope && !canvas.hasAttribute('data-lg-auto')) return;
        const inst = LiquidGlass.init({
            canvas,
            scope: scope ? document.querySelector(scope) : null,
            cardSelector: cardSelector || undefined,
            bgImageUrl: bgUrl || undefined,
        });
        if (inst) {
            // 自动加载用户配置（如果有）
            loadUserSettings(inst);
        }
    }

    // 从 /api/ui 或 localStorage 加载用户玻璃设置
    async function loadUserSettings(inst) {
        // 先尝试 localStorage（同步，避免闪烁）
        try {
            const cached = localStorage.getItem('lg-params');
            const cachedQ = localStorage.getItem('lg-quality');
            const cachedBg = localStorage.getItem('lg-bg');
            if (cachedQ) inst.setQuality(cachedQ);
            if (cached) inst.setParams(JSON.parse(cached));
            // 本地缓存的背景 URL（scoped 模式：直接给 shader 当纹理）
            if (cachedBg) {
                inst.setBg(cachedBg);
            }
        } catch {}
        // 后台异步拉后端配置（覆盖 localStorage）
        try {
            const token = localStorage.getItem('ai_token') || getCookie('userToken');
            if (!token) return;
            const API_BASE = (window.API_BASE || 'https://api.oscarstudio.cn') + '/api';
            const resp = await fetch(`${API_BASE}/ui`, { credentials: 'include' });
            const data = await resp.json();
            if (!data.success || !data.ui) return;
            const ui = data.ui;

            // 应用玻璃参数
            if (ui.liquidGlass) {
                const g = ui.liquidGlass;
                if (g.quality) inst.setQuality(g.quality);
                if (g.params) inst.setParams(g.params);
                try {
                    localStorage.setItem('lg-quality', g.quality || 'high');
                    localStorage.setItem('lg-params', JSON.stringify(g.params || DEFAULT_PARAMS));
                } catch {}
            }

            // 应用用户上传的背景图
            if (ui.backgroundImage) {
                const fullUrl = (window.UPLOAD_BASE || 'https://api.oscarstudio.cn') + ui.backgroundImage;
                inst.setBg(fullUrl);
                try { localStorage.setItem('lg-bg', fullUrl); } catch {}
                // 全屏模式：额外同步 body style（确保 user-button.js 后续也能看到）
                // scoped 模式：body 已被 cardContainer 隔离，不动 body 背景
                if (!inst.scope && !document.body.style.backgroundImage.includes(ui.backgroundImage)) {
                    document.body.style.backgroundImage = `url(${fullUrl})`;
                    document.body.style.backgroundSize = 'cover';
                    document.body.style.backgroundPosition = 'center';
                    document.body.style.backgroundRepeat = 'no-repeat';
                    document.body.style.backgroundAttachment = 'fixed';
                }
            }
        } catch (e) { /* 静默失败 */ }
    }

    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ============ 主类 ============
    class LiquidGlassInstance {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.scope = options.scope || null;
            this.cardSelector = options.cardSelector || '.glass-element';
            this.params = { ...DEFAULT_PARAMS };
            this.quality = 'high';
            this.enabled = true;
            this.pendingFrame = false;
            this.scrollIdleTimer = null;

            const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false, alpha: true })
                    || canvas.getContext('experimental-webgl');
            if (!gl) {
                document.body.classList.add('no-webgl');
                document.documentElement.classList.add('no-webgl');
                console.warn('[LiquidGlass] WebGL 不可用 → CSS 降级');
                this.gl = null;
                return;
            }
            this.gl = gl;
            this._initGL();
            // 默认渐变
            if (options._gradientTop) {
                this._gradientTop = options._gradientTop;
                this._gradientBot = options._gradientBot || [0.06, 0.09, 0.16];
            } else {
                this._gradientTop = [0.10, 0.05, 0.15];
                this._gradientBot = [0.06, 0.09, 0.16];
            }
            this._initBg(options.bgImageUrl);
            this._bindEvents();
            this.refresh();

            // 自动适应 canvas 容器大小（非全屏模式）
            if (options.scope) {
                this._resizeObserver = new ResizeObserver(() => this.refresh());
                this._resizeObserver.observe(this.scope);
            }

            // 0.5s + 2s 后再画一次（处理异步资源）
            setTimeout(() => this.refresh(), 500);
            setTimeout(() => this.refresh(), 2000);
        }

        _initGL() {
            const gl = this.gl;
            const vsSrc = `
                attribute vec2 a_position;
                varying vec2 v_uv;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_uv = a_position * 0.5 + 0.5;
                }
            `;
            const fsSrc = `
                precision highp float;
                varying vec2 v_uv;
                uniform vec2  u_resolution;
                uniform int   u_rectCount;
                uniform vec4  u_rects[${MAX_RECTS}];
                uniform float u_radius[${MAX_RECTS}];
                uniform float u_edgeThickness;
                uniform float u_refractionStrength;
                uniform float u_distortionCurve;
                uniform float u_frostiness;
                uniform float u_chromaticAmount;
                uniform float u_glassAlpha;
                uniform int   u_sampleSteps;
                uniform sampler2D u_bgImage;
                uniform float u_hasUserBg;
                // 默认渐变色（未上传背景图时用）
                uniform vec3 u_gradientTop;
                uniform vec3 u_gradientBot;

                float sdRoundedBox(vec2 p, vec2 b, float r) {
                    vec2 q = abs(p) - b + r;
                    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
                }

                vec4 sampleRect(vec2 fragCoord, vec4 rect, float radius) {
                    vec2 center = rect.xy;
                    vec2 halfExt = rect.zw;
                    vec2 p = fragCoord - center;
                    float sdf = sdRoundedBox(p, halfExt, radius);

                    float distToEdge = -sdf;
                    float edgeAmt = clamp(1.0 - distToEdge / max(u_edgeThickness, 1.0), 0.0, 1.0);
                    float distMag = u_refractionStrength * pow(edgeAmt, u_distortionCurve);

                    vec2 normDir = (length(p) > 0.001) ? normalize(-p) : vec2(0.0);
                    int steps = u_sampleSteps;
                    bool caActive = u_chromaticAmount > 0.001;

                    vec4 total = vec4(0.0);
                    float cnt = 0.0;
                    const int MAX_S = 5;

                    for (int sx = 0; sx < MAX_S; sx++) {
                        if (sx >= steps) break;
                        for (int sy = 0; sy < MAX_S; sy++) {
                            if (sy >= steps) break;
                            float sMax = max(float(steps - 1), 1.0);
                            vec2 frostOffset = vec2(
                                (float(sx) - float(steps - 1) * 0.5) / sMax * 2.0,
                                (float(sy) - float(steps - 1) * 0.5) / sMax * 2.0
                            ) * max(u_frostiness, 0.05);
                            vec2 sampleP = p + frostOffset;
                            float sampleSdf = sdRoundedBox(sampleP, halfExt, radius);
                            if (sampleSdf > 0.0) continue;
                            float sampleDist = -sampleSdf;
                            float sampleEdge = clamp(1.0 - sampleDist / max(u_edgeThickness, 1.0), 0.0, 1.0);
                            float sampleMag = u_refractionStrength * pow(sampleEdge, u_distortionCurve);
                            vec2 sampleNormDir = (length(sampleP) > 0.001) ? normalize(-sampleP) : vec2(0.0);
                            vec2 sampleFragCoord = sampleP + center;

                            if (caActive) {
                                float rDist = max(0.0, sampleMag - u_chromaticAmount * 0.5);
                                float gDist = sampleMag;
                                float bDist = sampleMag + u_chromaticAmount * 0.5;
                                vec2 rUv = (sampleFragCoord + sampleNormDir * rDist) / u_resolution;
                                vec2 gUv = (sampleFragCoord + sampleNormDir * gDist) / u_resolution;
                                vec2 bUv = (sampleFragCoord + sampleNormDir * bDist) / u_resolution;
                                total.r += texture2D(u_bgImage, rUv).r;
                                total.g += texture2D(u_bgImage, gUv).g;
                                total.b += texture2D(u_bgImage, bUv).b;
                                total.a += 1.0;
                            } else {
                                vec2 uv2 = (sampleFragCoord + sampleNormDir * sampleMag) / u_resolution;
                                vec4 c = texture2D(u_bgImage, uv2);
                                total += c;
                                cnt += 1.0;
                            }
                        }
                    }

                    vec4 sampled;
                    if (caActive) {
                        float denom = float(steps * steps);
                        sampled = vec4(total.rgb / denom, 1.0);
                    } else if (cnt > 0.0) {
                        sampled = total / cnt;
                    } else {
                        sampled = texture2D(u_bgImage, (fragCoord + normDir * distMag) / u_resolution);
                    }

                    vec4 tint = vec4(1.0, 1.0, 1.0, u_glassAlpha);
                    vec4 finalColor = mix(sampled, tint, tint.a);
                    float rimGlow = pow(edgeAmt, 3.0) * 0.3;
                    finalColor.rgb += vec3(rimGlow);
                    return finalColor;
                }

                void main() {
                    // fragCoord: 像素坐标（WebGL 默认 bottom-left 原点）
                    // JS 中所有 rect.cy 已经翻转成 bottom-up，跟这里一致
                    vec2 fragCoord = v_uv * u_resolution;

                    vec4 bgColor;
                    if (u_hasUserBg > 0.5) {
                        bgColor = texture2D(u_bgImage, v_uv);
                    } else {
                        float t = v_uv.y;
                        bgColor = vec4(mix(u_gradientBot, u_gradientTop, t), 1.0);
                    }

                    vec4 outColor = bgColor;
                    bool painted = false;
                    for (int i = 0; i < ${MAX_RECTS}; i++) {
                        if (i >= u_rectCount) break;
                        vec4 rect = u_rects[i];
                        vec2 p = fragCoord - rect.xy;
                        float sdf = sdRoundedBox(p, rect.zw, u_radius[i]);
                        if (sdf <= 0.0 && !painted) {
                            outColor = sampleRect(fragCoord, rect, u_radius[i]);
                            painted = true;
                        }
                    }
                    // 无用户背景时输出 alpha=0（canvas 透明，body 颜色直接显示）
                    gl_FragColor = vec4(outColor.rgb, u_hasUserBg);
                }
            `;

            const vs = this._compile(gl.VERTEX_SHADER, vsSrc);
            const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc);
            if (!vs || !fs) {
                document.body.classList.add('no-webgl');
                document.documentElement.classList.add('no-webgl');
                this.gl = null;
                return;
            }
            const prog = gl.createProgram();
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                console.error('[LiquidGlass] link 失败:', gl.getProgramInfoLog(prog));
                document.body.classList.add('no-webgl');
                document.documentElement.classList.add('no-webgl');
                this.gl = null;
                return;
            }
            gl.useProgram(prog);
            this.prog = prog;

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1,  1, -1,  -1,  1,
                -1,  1,  1, -1,   1,  1,
            ]), gl.STATIC_DRAW);
            const aPos = gl.getAttribLocation(prog, 'a_position');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            this.U = {
                res:    gl.getUniformLocation(prog, 'u_resolution'),
                count:  gl.getUniformLocation(prog, 'u_rectCount'),
                rects:  gl.getUniformLocation(prog, 'u_rects'),
                radius: gl.getUniformLocation(prog, 'u_radius'),
                edge:   gl.getUniformLocation(prog, 'u_edgeThickness'),
                refr:   gl.getUniformLocation(prog, 'u_refractionStrength'),
                curve:  gl.getUniformLocation(prog, 'u_distortionCurve'),
                frost:  gl.getUniformLocation(prog, 'u_frostiness'),
                ca:     gl.getUniformLocation(prog, 'u_chromaticAmount'),
                alpha:  gl.getUniformLocation(prog, 'u_glassAlpha'),
                steps:  gl.getUniformLocation(prog, 'u_sampleSteps'),
                bg:     gl.getUniformLocation(prog, 'u_bgImage'),
                hasBg:  gl.getUniformLocation(prog, 'u_hasUserBg'),
                gradT:  gl.getUniformLocation(prog, 'u_gradientTop'),
                gradB:  gl.getUniformLocation(prog, 'u_gradientBot'),
            };

            this.rectsData = new Float32Array(MAX_RECTS * 4);
            this.radiusData = new Float32Array(MAX_RECTS);
        }

        _compile(type, src) {
            const gl = this.gl;
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.error('[LiquidGlass] shader 编译失败:', gl.getShaderInfoLog(s));
                return null;
            }
            return s;
        }

        _initBg(initialUrl) {
            const gl = this.gl;
            this.tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([6, 9, 22, 255]));
            gl.uniform1i(this.U.bg, 0);
            this.hasUserBg = false;
            gl.uniform1f(this.U.hasBg, 0.0);

            this.lastBgCss = '';
            // 全屏模式：监听 body 背景
            if (!this.scope) {
                const bgObserver = new MutationObserver(() => this._syncBodyBg());
                bgObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
                this._bgObserver = bgObserver;
                this._syncBodyBg();
            }
            if (initialUrl) this.setBg(initialUrl);
        }

        _syncBodyBg() {
            const css = document.body.style.backgroundImage || '';
            if (css === this.lastBgCss) return;
            this.lastBgCss = css;
            console.log('[LiquidGlass] body bg 变化 →', css.slice(0, 80));
            const m = css.match(/url\(["']?(.+?)["']?\)/);
            if (m) this.setBg(m[1]);
            else {
                this.hasUserBg = false;
                this.gl.uniform1f(this.U.hasBg, 0.0);
                this.refresh();
            }
        }

        setBg(url) {
            const gl = this.gl;
            if (!gl) return;
            if (!url) {
                this.hasUserBg = false;
                gl.uniform1f(this.U.hasBg, 0.0);
                this.refresh();
                return;
            }
            console.log('[LiquidGlass] 加载背景:', url);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                if (!this.gl) return;
                console.log('[LiquidGlass] 背景加载成功:', img.width, 'x', img.height);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
                // HTML5 Image 是 top-down，WebGL texture 是 bottom-up，需要翻转 Y
                this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
                this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
                this.hasUserBg = true;
                this.gl.uniform1f(this.U.hasBg, 1.0);
                this.refresh();
            };
            img.onerror = (e) => {
                console.warn('[LiquidGlass] 背景图加载失败:', url, e && e.message);
                this.hasUserBg = false;
                if (this.gl) this.gl.uniform1f(this.U.hasBg, 0.0);
                this.refresh();
            };
            img.src = url;
        }

        _bindEvents() {
            window.addEventListener('scroll', () => {
                if (this.scrollIdleTimer) clearTimeout(this.scrollIdleTimer);
                this.scrollIdleTimer = setTimeout(() => this.refresh(), 120);
                this.refresh();
            }, { passive: true });

            window.addEventListener('resize', () => this.refresh());

            // hover 玻璃元素（CSS transform 不会触发 MutationObserver，需主动 refresh）
            // mouseover/mouseout 用事件委托，在 .glass-element 上 mouseenter/mouseleave 触发 refresh
            if (!this.scope) {
                const handler = (e) => {
                    if (e.target.closest && e.target.closest('.glass-element')) {
                        this.refresh();
                    }
                };
                document.body.addEventListener('mouseover', handler);
                document.body.addEventListener('mouseout', handler);
            }

            if (!this.scope) {
                const domObserver = new MutationObserver(() => this.refresh());
                domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
                this._domObserver = domObserver;
            }
        }

        _collectRects() {
            const root = this.scope || document;
            const nodes = root.querySelectorAll(this.cardSelector);
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            // canvas 像素坐标系（WebGL 左下原点）
            const cw = this.canvas.width / dpr;
            const ch = this.canvas.height / dpr;

            // scope 模式：canvas 像素坐标基于 scope 元素位置
            let offsetX = 0, offsetY = 0;
            let sr = null;
            if (this.scope) {
                sr = this.scope.getBoundingClientRect();
                offsetX = -sr.left;
                offsetY = -sr.top;
            }

            let count = 0;
            for (let i = 0; i < nodes.length && count < MAX_RECTS; i++) {
                const el = nodes[i];
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

                // scope 模式下：跳过超出 scope 边界的元素（使用相对 scope 的坐标）
                if (this.scope) {
                    const relLeft = r.left - sr.left;
                    const relRight = r.right - sr.left;
                    const relTop = r.top - sr.top;
                    const relBottom = r.bottom - sr.top;
                    if (relRight < 0 || relBottom < 0 || relLeft > cw || relTop > ch) continue;
                } else {
                    if (r.bottom < -50 || r.top > ch + 50) continue;
                }

                // 父级隐藏检查
                let parent = el.parentElement;
                let hidden = false;
                while (parent && parent !== document.body) {
                    const pcs = getComputedStyle(parent);
                    if (pcs.display === 'none' || pcs.visibility === 'hidden') { hidden = true; break; }
                    parent = parent.parentElement;
                }
                if (hidden) continue;

                // cx/cy 是 canvas 像素坐标（左下原点）
                const cx = (r.left + r.width / 2 + offsetX) * dpr;
                const cyFromTop = (r.top + r.height / 2 + offsetY) * dpr;
                const cy = this.canvas.height - cyFromTop;  // 翻转
                const hw = (r.width / 2) * dpr;
                const hh = (r.height / 2) * dpr;

                let radius = 0;
                const br = cs.borderRadius || cs.borderTopLeftRadius || '0';
                const parts = br.split(/\s+/);
                const pxVals = parts.map(p => {
                    if (p.endsWith('px')) return parseFloat(p);
                    if (p.endsWith('%')) return Math.min(parseFloat(p) / 100 * Math.min(r.width, r.height), Math.min(r.width, r.height));
                    if (p.endsWith('rem')) return parseFloat(p) * 16;
                    return 0;
                });
                radius = Math.max(...pxVals, 0) * dpr;

                const idx = count * 4;
                this.rectsData[idx]     = cx;
                this.rectsData[idx + 1] = cy;
                this.rectsData[idx + 2] = hw;
                this.rectsData[idx + 3] = hh;
                this.radiusData[count] = Math.min(radius, Math.min(hw, hh));
                count++;
            }
            return count;
        }

            refresh() {
                if (!this.gl) return;
                if (this.quality === 'low') return;
                if (this.pendingFrame) return;
                this.pendingFrame = true;
                try {
                    this._render();
                } catch (e) {
                    console.warn('[LiquidGlass] refresh failed:', e);
                }
                requestAnimationFrame(() => {
                    this.pendingFrame = false;
                    try { this._render(); } catch (e) { /* ignore */ }
                });
            }

        _render() {
            this.pendingFrame = false;
            if (!this.gl || this.quality === 'low') return;
            const gl = this.gl;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            // 设定 canvas 尺寸
            let cssW, cssH;
            if (this.scope) {
                const sr = this.scope.getBoundingClientRect();
                cssW = Math.max(1, Math.floor(sr.width));
                cssH = Math.max(1, Math.floor(sr.height));
            } else {
                cssW = window.innerWidth;
                cssH = window.innerHeight;
            }
            const pxW = Math.floor(cssW * dpr);
            const pxH = Math.floor(cssH * dpr);
            if (this.canvas.width !== pxW) this.canvas.width = pxW;
            if (this.canvas.height !== pxH) this.canvas.height = pxH;
            if (this.canvas.style.width !== cssW + 'px') this.canvas.style.width = cssW + 'px';
            if (this.canvas.style.height !== cssH + 'px') this.canvas.style.height = cssH + 'px';

            gl.viewport(0, 0, this.canvas.width, this.canvas.height);

            const count = this._collectRects();
            gl.uniform2f(this.U.res, this.canvas.width, this.canvas.height);
            gl.uniform1i(this.U.count, count);
            gl.uniform4fv(this.U.rects, this.rectsData);
            gl.uniform1fv(this.U.radius, this.radiusData);
            gl.uniform1f(this.U.edge, this.params.edge * dpr);
            gl.uniform1f(this.U.refr, this.params.refr);
            gl.uniform1f(this.U.curve, this.params.curve);
            gl.uniform1f(this.U.frost, this.params.frost);
            gl.uniform1f(this.U.ca, this.params.ca);
            gl.uniform1f(this.U.alpha, this.params.alpha);
            gl.uniform3fv(this.U.gradT, this._gradientTop);
            gl.uniform3fv(this.U.gradB, this._gradientBot);
            const steps = this.params.frost > 0.05 ? 3 : 1;
            gl.uniform1i(this.U.steps, steps);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        setQuality(q) {
            if (!QUALITY_PRESETS[q]) return;
            this.quality = q;
            if (q === 'low') {
                document.body.classList.add('quality-low');
                document.body.classList.remove('quality-mid', 'quality-high');
                return;
            }
            document.body.classList.remove('quality-low', 'quality-mid', 'quality-high');
            document.body.classList.add('quality-' + q);
            // 中档强制关 frost/ca
            if (q === 'mid') {
                this.params = { ...this.params, ...QUALITY_PRESETS.mid };
            } else if (q === 'high') {
                // 恢复默认值（如果当前是 mid）
                if (this.params.frost === 0 && this.params.ca === 0) {
                    this.params = { ...DEFAULT_PARAMS };
                }
            }
            this.refresh();
        }

        setParams(p) {
            this.params = { ...this.params, ...p };
            // 缓存到 localStorage
            try { localStorage.setItem('lg-params', JSON.stringify(this.params)); } catch {}
            this.refresh();
        }

        getParams() { return { ...this.params }; }
        getQuality() { return this.quality; }

        destroy() {
            if (this._resizeObserver) this._resizeObserver.disconnect();
            if (this._bgObserver) this._bgObserver.disconnect();
            if (this._domObserver) this._domObserver.disconnect();
            if (this.gl) {
                const ext = this.gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
            }
        }
    }

    // ============ 公共 API ============
    let instance = null;
    const LiquidGlass = {
        init(options = {}) {
            const canvas = options.canvas || document.getElementById('liquid-glass-canvas');
            if (!canvas) return null;
            // 已有实例 + 同一 canvas + 同一 scope：返回现有
            if (instance && instance.canvas === canvas && !options.force) {
                // 若提供了新参数，覆盖
                if (options.scope !== undefined || options.bgImageUrl !== undefined || options.cardSelector !== undefined) {
                    if (options.scope !== undefined) instance.scope = options.scope;
                    if (options.cardSelector !== undefined) instance.cardSelector = options.cardSelector;
                    if (options.bgImageUrl !== undefined) instance.setBg(options.bgImageUrl || null);
                    instance.refresh();
                }
                return instance;
            }
            // 不同 canvas 或强制：销毁旧的
            if (instance) instance.destroy();
            try {
                instance = new LiquidGlassInstance(canvas, options);
                if (!instance.gl) instance = null;
            } catch (e) {
                console.error('[LiquidGlass] 初始化失败:', e);
                instance = null;
                document.body.classList.add('no-webgl');
                document.documentElement.classList.add('no-webgl');
            }
            return instance;
        },
        setQuality(q) { if (instance) instance.setQuality(q); },
        setParams(p) { if (instance) instance.setParams(p); },
        getParams() { return instance ? instance.getParams() : { ...DEFAULT_PARAMS }; },
        getQuality() { return instance ? instance.getQuality() : 'high'; },
        setBg(url) { if (instance) instance.setBg(url); },
        refresh() { if (instance) instance.refresh(); },
        destroy() { if (instance) { instance.destroy(); instance = null; } },
    };
    window.LiquidGlass = LiquidGlass;

    // ============ 自动初始化 ============
    function start() { autoInit(); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
