"use strict";

const $ = id => document.getElementById(id);
const icons = {
    book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm0 13a2 2 0 0 1 2-2h12M9 4v11"/>',
    home: '<path d="m3 11 9-7 9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    library: '<path d="M4 5h4v14H4zM10 5h4v14h-4zM16 6l3-1 4 13-3 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M10 3h4l.6 2.2L17 6.5l2.2-.6 2 3.5-1.6 1.6v2l1.6 1.6-2 3.5-2.2-.6-2.4 1.3L14 21h-4l-.6-2.2L7 17.5l-2.2.6-2-3.5L4.4 13v-2L2.8 9.4l2-3.5 2.2.6 2.4-1.3z"/>',
    spark: '<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z"/>',
    repeat: '<path d="m16 3 4 4-4 4M20 7H7a3 3 0 0 0-3 3v1m4 10-4-4 4-4m-4 4h13a3 3 0 0 0 3-3v-1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>',
};

function setIcon(element, name) {
    element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
}
document.querySelectorAll("[data-icon]").forEach(element => setIcon(element, element.dataset.icon));

const API_BASE = "https://api.oscarstudio.cn/api";
const studyNames = { recite: "背诵新词", review: "到期复习" };
const statusNames = { new: "未学习", learning: "学习中", mastered: "已掌握" };
const emptyExample = {
    example_sentence: null, example_translation: null, example_target: null,
    example_target_start: null, example_target_end: null,
};
const ratingModes = ["adaptive", "always4", "simple3"];
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const todayFormat = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" });
let words = null;
let settings = readSettings();
let session = null;
let entryWord = null;
let deleteTarget = null;
let selection = null;
let importEntries = [];
let loading = false;
let toastTimer;

function readSettings() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("wordbook_settings")); } catch { /* 默认设置可用 */ }
    const { dailyCount, desiredRetention, ratingUI } = saved ?? {};
    return {
        algorithm: "fsrs",
        dailyCount: Number.isInteger(dailyCount) && dailyCount >= 1 && dailyCount <= 50 ? dailyCount : 10,
        desiredRetention: typeof desiredRetention === "number" && desiredRetention >= .8 && desiredRetention <= .95 ? desiredRetention : .9,
        ratingUI: ratingModes.includes(ratingUI) ? ratingUI : "adaptive",
    };
}

function getToken() {
    const cookie = document.cookie.split("; ").find(value => value.startsWith("userToken="));
    return cookie?.slice("userToken=".length) || localStorage.getItem("ai_token") || localStorage.getItem("userToken");
}

async function request(method = "GET", id, body) {
    const token = getToken();
    if (!token) throw new Error("请先登录再使用摘词本。");
    let response;
    try {
        const path = id == null ? "/wordbook" : "/wordbook/" + encodeURIComponent(id);
        response = await fetch(API_BASE + path, {
            method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new Error("无法连接服务器，请检查网络后重试。");
    }
    if (response.status === 401) {
        localStorage.removeItem("ai_token");
        localStorage.removeItem("userToken");
        window.__oscarAuth.redirectToLogin();
        throw new Error("登录已失效，请重新登录。");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.message || "服务器暂时不可用，请重试。");
    if ((method === "PUT" || (method === "POST" && id !== "bulk")) && !result.word?.id) throw new Error("服务器未返回已保存的词条，请重试。");
    return result;
}

function showError(id, message = "") {
    $(id).textContent = message;
    $(id).hidden = !message;
}

function notify(message) {
    clearTimeout(toastTimer);
    $("toast").hidden = false;
    $("toast").textContent = message;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3300);
}

function isDue(word, now) {
    return word.status === "learning" && (!word.next_review || new Date(word.next_review).getTime() <= now);
}

function queueFor(mode) {
    if (mode === "recite") return words.filter(word => word.status === "new").slice(0, settings.dailyCount);
    const now = Date.now();
    return words.filter(word => isDue(word, now))
        .sort((a, b) => Date.parse(a.next_review ?? "1970-01-01") - Date.parse(b.next_review ?? "1970-01-01"));
}

function renderHome() {
    const counts = { new: 0, learning: 0, mastered: 0 };
    for (const word of words) {
        if (Object.hasOwn(counts, word.status)) counts[word.status]++;
    }
    const due = queueFor("review").length;
    const fresh = queueFor("recite").length;
    $("today").textContent = todayFormat.format(new Date());
    $("navCount").textContent = words.length;
    $("navCount").hidden = !words.length;
    $("statTotal").textContent = words.length;
    $("statNew").textContent = counts.new;
    $("statLearning").textContent = counts.learning;
    $("statMastered").textContent = counts.mastered;
    $("reviewSummary").textContent = due ? due + " 个词条待复习" : "暂无到期词条";
    const freshSummary = fresh + " 个词条 · 本组";
    $("reciteSummary").textContent = fresh ? freshSummary : "暂无新词可背诵";
    $("heroLabel").textContent = due ? "今日复习" : fresh ? "新词练习" : words.length ? "今日计划" : "新词本";
    const heroTitle = $("heroTitle");
    if (due || fresh) {
        const number = node("em", due || fresh);
        heroTitle.replaceChildren(due ? "复习 " : "背诵 ", number, due ? " 个到期词条" : " 个新词");
    } else {
        heroTitle.textContent = words.length ? "今天的任务完成了" : "从第一个词条开始";
    }
    $("heroDescription").textContent = due ? "先巩固记忆，再背诵新词。"
        : fresh ? "看中文释义，写出对应的英文。"
        : words.length ? "新的复习到期后会出现在这里。" : "把遇到的单词、短语和例句收进词本。";
    $("heroActionLabel").textContent = due ? "开始复习" : fresh ? "开始背诵" : words.length ? "打开词库" : "录入第一个词条";
    $("heroAction").onclick = () => {
        if (due || fresh) startStudy(due ? "review" : "recite");
        else if (words.length) location.hash = "library";
        else openEntry();
    };
}

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function rowAction(label, icon, handler) {
    const button = node("button", null, "icon-button" + (icon === "trash" ? " danger" : ""));
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.onclick = handler;
    return button;
}

function renderLibrary() {
    const status = $("filterStatus").value;
    const sort = $("filterSort").value;
    const search = normalize($("searchWords").value);
    const list = words.filter(word => (status === "all" || word.status === status) &&
        (!search || normalize(word.word).includes(search) || normalize(word.translation).includes(search)));
    list.sort((a, b) => {
        if (sort === "alpha") return a.word.localeCompare(b.word, "en");
        const delta = Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
        return sort === "date-asc" ? -delta : delta;
    });
    $("librarySummary").textContent = list.length === words.length ? "共 " + words.length + " 个词条"
        : "显示 " + list.length + " 个词条，共 " + words.length + " 个";
    $("libraryEmpty").hidden = !!list.length;
    $("emptyTitle").textContent = words.length ? "没有匹配的词条" : "词库还是空的";
    $("emptyDescription").textContent = words.length ? "试试其他关键词或学习状态。" : "录入一个词条，就可以开始背诵。";
    $("emptyAdd").hidden = !!words.length;

    const fragment = document.createDocumentFragment();
    const now = Date.now();
    for (const word of list) {
        const row = node("li", null, "word-row");
        const term = node("div", word.word, "word-term");
        term.lang = "en";
        const info = node("div");
        info.append(term, node("p", word.translation));
        if (word.example_sentence) {
            const example = node("details", null, "word-example");
            const sentence = node("p", word.example_sentence);
            sentence.lang = "en";
            example.append(node("summary", "查看例句"), sentence);
            if (word.example_translation) example.append(node("p", word.example_translation));
            info.append(example);
        }
        const meta = node("div", null, "word-meta");
        meta.append(node("span", statusNames[word.status] ?? statusNames.new, "word-status " + word.status));
        if (isDue(word, now)) meta.append(node("span", "待复习"));
        else if (word.status === "learning" && word.next_review) {
            const next = new Date(word.next_review);
            if (Number.isFinite(next.getTime())) meta.append(node("span", "下次复习 " + dateFormat.format(next)));
        }
        if (typeof word.stability === "number" && word.stability > 0) {
            const metrics = ["稳定性 " + word.stability.toFixed(1) + " 天"];
            if (typeof word.difficulty === "number" && word.difficulty > 0) metrics.push("难度 " + word.difficulty.toFixed(1));
            meta.append(node("span", metrics.join(" · ")));
        }
        const actions = node("div", null, "row-actions");
        actions.append(
            rowAction(word.example_sentence ? "编辑例句" : "添加例句", "edit", () => openEntry(word)),
            rowAction("删除 " + word.word, "trash", () => openDelete(word)),
        );
        row.append(info, meta, actions);
        fragment.append(row);
    }
    $("wordList").replaceChildren(fragment);
}

function renderPage(focus = true) {
    if (!words) return;
    const route = location.hash.slice(1);
    if (Object.hasOwn(studyNames, route) && session?.mode !== route) {
        if (session?.saving) {
            location.replace("#" + session.mode);
            return;
        }
        createSession(route);
    }
    const page = route === "library" ? "library" : Object.hasOwn(studyNames, route) ? "study" : "home";
    for (const name of ["home", "library", "study"]) $(name + "Page").hidden = name !== page;
    document.querySelectorAll("[data-page]").forEach(link => {
        if (link.dataset.page === page || (page === "study" && link.dataset.page === "home")) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    if (page === "home") renderHome();
    if (page === "library") renderLibrary();
    if (focus) {
        window.scrollTo(0, 0);
        $(page + "Title").focus({ preventScroll: true });
    }
}

async function load() {
    if (loading) return;
    loading = true;
    $("retryLoad").hidden = true;
    $("loadMessage").textContent = "正在载入摘词本…";
    try {
        const result = await request();
        if (!Array.isArray(result.words)) throw new Error("词库数据读取失败，请重试。");
        words = result.words;
        $("loadState").hidden = true;
        renderHome();
        renderPage(false);
        document.querySelector(".add-button").disabled = false;
    } catch (error) {
        $("loadMessage").textContent = error.message;
        $("retryLoad").hidden = false;
    } finally {
        loading = false;
    }
}

function normalize(value) {
    return String(value ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

function findExampleRange(sentence, target, preferred) {
    if (!sentence || !target) return null;
    if (preferred && preferred.start >= 0 && preferred.end > preferred.start && preferred.end <= sentence.length
        && normalize(sentence.slice(preferred.start, preferred.end)) === normalize(target)) return preferred;
    const escaped = normalize(target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/'/g, "['’‘]");
    const boundary = "[\\p{L}\\p{N}]";
    const pattern = (/^[\p{L}\p{N}]/u.test(target) ? "(?<!" + boundary + ")" : "")
        + escaped + (/[\p{L}\p{N}]$/u.test(target) ? "(?!" + boundary + ")" : "");
    const match = new RegExp(pattern, "iu").exec(sentence);
    return match ? { start: match.index, end: match.index + match[0].length } : null;
}

function exampleFor(word) {
    const sentence = word.example_sentence?.trim();
    const target = word.example_target?.trim() || word.word;
    const range = findExampleRange(sentence, target, { start: word.example_target_start, end: word.example_target_end });
    if (!range) return null;
    return { sentence, target: sentence.slice(range.start, range.end), range, translation: word.example_translation };
}

function buildExample(term) {
    const raw = $("exampleSentence").value;
    const sentence = raw.trim();
    const target = $("exampleTarget").value.trim() || term;
    const translation = $("exampleTranslation").value.trim();
    if (!sentence) {
        if ($("exampleTarget").value.trim() || translation) throw new Error("请先填写英文例句。");
        return emptyExample;
    }
    if (!translation) throw new Error("请填写整句翻译。");
    const offset = raw.length - raw.trimStart().length;
    const range = findExampleRange(sentence, target, selection && { start: selection.start - offset, end: selection.end - offset });
    if (!range) throw new Error("例句中找不到完整的挖空内容。请选中实际文本，或手动填写目标词形。");
    return {
        example_sentence: sentence, example_translation: translation,
        example_target: sentence.slice(range.start, range.end),
        example_target_start: range.start, example_target_end: range.end,
    };
}

function openEntry(word = null) {
    if (!words) return;
    entryWord = word;
    selection = word ? { start: word.example_target_start, end: word.example_target_end } : null;
    $("entryForm").reset();
    const editing = !!word;
    $("entryFields").hidden = editing;
    $("wordInput").disabled = editing;
    $("transInput").disabled = editing;
    $("entryTitle").textContent = editing ? "编辑例句" : "录入词条";
    $("entrySubtitle").textContent = editing ? word.word + " · " + word.translation : "";
    $("entrySubtitle").hidden = !editing;
    $("exampleDetails").open = editing;
    $("exampleSentence").value = word?.example_sentence || "";
    $("exampleTarget").value = word?.example_target || "";
    $("exampleTranslation").value = word?.example_translation || "";
    $("clearExample").hidden = !word?.example_sentence;
    $("saveEntry").textContent = editing ? "保存例句" : "保存词条";
    showError("entryError");
    $("exampleAiStatus").textContent = "";
    $("entryDialog").showModal();
    $(editing ? "exampleSentence" : "wordInput").focus();
}

function useSelectedText() {
    const field = $("exampleSentence");
    const raw = field.value.slice(field.selectionStart, field.selectionEnd);
    const text = raw.trim();
    if (!text) {
        showError("entryError", "请先在例句中选中要挖空的文本。");
        return;
    }
    const start = field.selectionStart + raw.length - raw.trimStart().length;
    selection = { start, end: start + text.length };
    $("exampleTarget").value = text;
    showError("entryError");
}

function setDialogBusy(dialog, busy) {
    dialog.dataset.busy = busy ? "true" : "false";
    for (const button of dialog.querySelectorAll("button")) button.disabled = busy;
}

async function generateExample() {
    const dialog = $("entryDialog");
    if (dialog.dataset.busy === "true") return;
    const term = entryWord?.word ?? $("wordInput").value.trim();
    const meaning = entryWord?.translation ?? $("transInput").value.trim();
    const status = $("exampleAiStatus");
    const token = getToken();

    status.textContent = "";
    showError("entryError");
    if (!term) return showError("entryError", "请先填写单词、短语或词块。");
    if (!token) return showError("entryError", "请先登录再使用 AI。");

    const instruction = "你是英语学习助手。根据词条和释义，写一句自然简短的英文例句并译成简体中文。"
        + "只返回一个 JSON 对象，包含三个字符串字段：sentence（完整英文例句）、target（词条在例句中的实际写法，可变换词形，必须逐字摘自 sentence）、translation（整句中文翻译）。";
    const input = { 词条: term, 释义: meaning };
    // 正在输入的内容优先于稍后返回的生成结果。
    const fields = ["wordInput", "transInput", "exampleSentence", "exampleTarget", "exampleTranslation"];
    const values = fields.map(id => $(id).value);
    setDialogBusy(dialog, true);
    status.textContent = "正在生成例句、挖空和翻译…";
    try {
        const response = await fetch(API_BASE + "/chat", {
            method: "POST",
            headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(25000),
            body: JSON.stringify({
                model: "tencent/hy4-flash", thinking: false, max_tokens: 256,
                messages: [{ role: "system", content: instruction }, { role: "user", content: JSON.stringify(input) }],
            }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
            if (response.status === 403) throw new Error(result?.message || "AI 积分不足，请稍后重试。");
            if (response.status === 429) throw new Error("AI 服务繁忙，请稍后重试。");
            throw new Error("AI 生成失败，请稍后重试。");
        }
        const choice = result?.choices?.[0];
        const content = choice?.message?.content;
        const generated = typeof content === "string" ? content.trim() : "";
        if (!generated || choice.finish_reason === "length") throw new Error("AI 未返回完整内容，请重试。");
        if (fields.some((id, index) => $(id).value !== values[index])) {
            status.textContent = "输入已修改，请重新生成。";
            return;
        }
        const example = JSON.parse(generated.replace(/^```(?:json)?\s*|\s*```$/gi, ""));
        const { sentence, target, translation } = example ?? {};
        if (![sentence, target, translation].every(value => typeof value === "string" && value.trim())) {
            throw new Error("AI 未返回完整内容，请重试。");
        }
        const text = sentence.trim();
        const range = findExampleRange(text, target.trim());
        if (!range) throw new Error("生成的挖空内容与例句不一致，请重试。");
        $("exampleSentence").value = text;
        $("exampleTarget").value = text.slice(range.start, range.end);
        $("exampleTranslation").value = translation.trim();
        selection = range;
        status.textContent = "例句、挖空和翻译已生成。";
    } catch (error) {
        status.textContent = "";
        const message = error.name === "TimeoutError" ? "AI 响应超时，请重试。"
            : error instanceof SyntaxError ? "AI 未返回完整内容，请重试。"
            : error instanceof TypeError ? "无法连接 AI 服务，请检查网络后重试。" : error.message;
        showError("entryError", message);
    } finally {
        setDialogBusy(dialog, false);
    }
}

async function saveEntry(clear = false) {
    const dialog = $("entryDialog");
    if (dialog.dataset.busy === "true") return;
    const existing = entryWord;
    const term = existing?.word ?? $("wordInput").value.trim();
    const translation = existing?.translation ?? $("transInput").value.trim();
    try {
        if (!term || !translation) throw new Error("请填写词条和中文释义。");
        const example = clear ? emptyExample : buildExample(term);
        showError("entryError");
        setDialogBusy(dialog, true);
        if (existing) {
            const result = await request("PUT", existing.id, example);
            Object.assign(existing, result.word);
            if (!$("libraryPage").hidden) renderLibrary();
        } else {
            const result = await request("POST", null, { word: term, translation, ...example });
            words.unshift(result.word);
            renderHome();
            if (!$("libraryPage").hidden) {
                $("searchWords").value = "";
                $("filterStatus").value = "all";
                renderLibrary();
            }
        }
        dialog.close();
        notify(clear ? "已清除例句" : existing ? "已保存例句" : "已录入词条");
    } catch (error) {
        $("exampleDetails").open = true;
        showError("entryError", error.message);
    } finally {
        setDialogBusy(dialog, false);
    }
}

function openDelete(word) {
    deleteTarget = word;
    $("deleteDescription").textContent = "删除「" + word.word + "」及其学习记录？此操作无法撤销。";
    showError("deleteError");
    $("deleteDialog").showModal();
}

async function deleteWord() {
    const dialog = $("deleteDialog");
    if (dialog.dataset.busy === "true") return;
    const word = deleteTarget;
    if (session?.queue[session.index] === word && session.saving) {
        showError("deleteError", "正在保存这条学习记录，请稍后重试。");
        return;
    }
    setDialogBusy(dialog, true);
    showError("deleteError");
    try {
        await request("DELETE", word.id);
        words = words.filter(item => item !== word);
        if (session) {
            const position = session.queue.indexOf(word, session.index + Number(session.saved));
            if (position >= 0) {
                session.queue.splice(position, 1);
                if (position === session.index) renderStudy();
                else renderProgress();
            }
        }
        dialog.close();
        renderHome();
        renderLibrary();
        $("searchWords").focus();
        notify("已删除词条");
    } catch (error) {
        showError("deleteError", error.message);
    } finally {
        setDialogBusy(dialog, false);
    }
}

const importFields = {
    word: ["word", "单词", "词条", "term"],
    translation: ["translation", "释义", "中文释义", "meaning"],
    example_sentence: ["example_sentence", "example", "例句", "英文例句", "sentence"],
    example_translation: ["example_translation", "例句翻译", "整句翻译"],
    example_target: ["example_target", "挖空", "挖空内容", "target"],
};

function pickField(source, keys) {
    for (const key of keys) {
        const value = source?.[key];
        if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
}

function normalizeEntry(source) {
    const word = pickField(source, importFields.word);
    const translation = pickField(source, importFields.translation);
    if (!word || !translation) return null;
    return {
        word, translation,
        example_sentence: pickField(source, importFields.example_sentence),
        example_translation: pickField(source, importFields.example_translation),
        example_target: pickField(source, importFields.example_target),
    };
}

function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += ch;
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ",") {
            row.push(field); field = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(field);
            if (row.some(cell => cell.trim())) rows.push(row);
            row = []; field = "";
        } else field += ch;
    }
    if (field.length || row.length) {
        row.push(field);
        if (row.some(cell => cell.trim())) rows.push(row);
    }
    return rows;
}

function parseImportText(text, filename) {
    const content = text.replace(/^\uFEFF/, "").trim();
    if (!content) throw new Error("文件是空的。");
    if (filename.toLowerCase().endsWith(".json") || /^[[{]/.test(content)) {
        let data;
        try { data = JSON.parse(content); } catch { throw new Error("JSON 解析失败，请检查文件格式。"); }
        const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
        if (!list) throw new Error("JSON 需要是数组，或包含 words 数组的对象。");
        const entries = [];
        let invalid = 0;
        for (const item of list) {
            const entry = normalizeEntry(item);
            if (entry) entries.push(entry); else invalid++;
        }
        return { entries, invalid };
    }
    const rows = parseCsv(content);
    if (rows.length < 2) throw new Error("CSV 至少需要一行表头和一行数据。");
    const headers = rows[0].map(header => header.trim().toLowerCase());
    const entries = [];
    let invalid = 0;
    for (const row of rows.slice(1)) {
        const record = {};
        headers.forEach((header, index) => { record[header] = row[index] ?? ""; });
        const entry = normalizeEntry(record);
        if (entry) entries.push(entry); else invalid++;
    }
    return { entries, invalid };
}

function openImport() {
    importEntries = [];
    $("importForm").reset();
    $("importPreview").hidden = true;
    $("importSummary").textContent = "";
    $("importList").replaceChildren();
    $("importFileName").textContent = "点击选择文件，自动解析并预览";
    $("confirmImport").disabled = true;
    showError("importError");
    $("importDialog").showModal();
}

async function handleImportFile(file) {
    if (!file) return;
    importEntries = [];
    $("importPreview").hidden = true;
    $("confirmImport").disabled = true;
    showError("importError");
    $("importFileName").textContent = file.name;
    try {
        const { entries, invalid } = parseImportText(await file.text(), file.name);
        if (!entries.length) throw new Error("没有找到有效的词条，请确认包含单词和释义两列。");
        const existing = new Set(words.map(word => normalize(word.word)));
        const seen = new Set();
        const fresh = [];
        let duplicates = 0;
        for (const entry of entries) {
            const key = normalize(entry.word);
            if (existing.has(key) || seen.has(key)) { duplicates++; continue; }
            seen.add(key);
            fresh.push(entry);
        }
        importEntries = fresh;
        const summary = $("importSummary");
        summary.replaceChildren("可导入 ", node("strong", fresh.length), " 个词条");
        const notes = [];
        if (duplicates) notes.push("跳过重复 " + duplicates + " 个");
        if (invalid) notes.push("忽略不完整 " + invalid + " 个");
        if (notes.length) summary.append("，" + notes.join("，"));
        summary.append("。");
        $("importList").replaceChildren(...fresh.slice(0, 30).map(entry => {
            const item = node("li");
            item.append(node("span", entry.word, "import-word"), node("span", entry.translation, "import-trans"));
            return item;
        }));
        $("importPreview").hidden = false;
        $("confirmImport").disabled = fresh.length === 0;
        if (!fresh.length) showError("importError", "文件里的词条都已存在，没有需要导入的内容。");
    } catch (error) {
        importEntries = [];
        $("importFileName").textContent = "点击选择文件，自动解析并预览";
        showError("importError", error.message);
    }
}

function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function downloadTemplate(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCsvTemplate() {
    const rows = [
        ["word", "translation", "example_sentence", "example_translation", "example_target"],
        ["look forward to", "期待，盼望", "I look forward to seeing you.", "我期待见到你。", "look forward to"],
        ["abandon", "放弃；抛弃", "They had to abandon the car.", "他们不得不弃车。", "abandon"],
    ];
    const content = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    downloadTemplate("摘词本-导入模板.csv", content, "text/csv");
}

function downloadJsonTemplate() {
    const content = JSON.stringify([
        {
            word: "look forward to", translation: "期待，盼望",
            example_sentence: "I look forward to seeing you.", example_translation: "我期待见到你。",
            example_target: "look forward to",
        },
        {
            word: "abandon", translation: "放弃；抛弃",
            example_sentence: "They had to abandon the car.", example_translation: "他们不得不弃车。",
            example_target: "abandon",
        },
    ], null, 2);
    downloadTemplate("摘词本-导入模板.json", content, "application/json");
}

async function importWords() {
    const dialog = $("importDialog");
    if (dialog.dataset.busy === "true") return;
    if (!importEntries.length) {
        showError("importError", "没有可导入的词条，请先选择文件。");
        return;
    }
    showError("importError");
    setDialogBusy(dialog, true);
    const batches = [];
    for (let i = 0; i < importEntries.length; i += 500) batches.push(importEntries.slice(i, i + 500));
    try {
        let imported = 0, skipped = 0;
        for (let i = 0; i < batches.length; i++) {
            $("confirmImport").textContent = batches.length > 1 ? "导入中… " + (i + 1) + "/" + batches.length : "导入中…";
            const result = await request("POST", "bulk", { words: batches[i] });
            imported += result.imported || 0;
            skipped += result.skipped || 0;
        }
        dialog.close();
        const skipNote = skipped ? "，跳过 " + skipped + " 个" : "";
        notify(imported ? "成功导入 " + imported + " 个词条" + skipNote : "没有导入新词条" + skipNote);
        await load();
    } catch (error) {
        showError("importError", error.message);
    } finally {
        setDialogBusy(dialog, false);
        $("confirmImport").textContent = "开始导入";
    }
}

function openSettings() {
    $("dailyCount").value = settings.dailyCount;
    $("desiredRetention").value = settings.desiredRetention;
    $("ratingUI").value = settings.ratingUI;
    updateRetentionLabel();
    $("settingsDialog").showModal();
}

function updateRetentionLabel() {
    $("retentionValue").textContent = Math.round(Number($("desiredRetention").value) * 100) + "%";
}

function createSession(mode) {
    session = { mode, queue: queueFor(mode), index: 0 };
    renderStudy();
}

function startStudy(mode) {
    if (session?.saving && session.mode !== mode) {
        notify("正在保存当前学习记录。");
        return;
    }
    if (session?.mode !== mode || session.index >= session.queue.length) createSession(mode);
    location.hash = mode;
}

function renderProgress() {
    const total = session.queue.length;
    const completed = session.index + Number(!!session.saved);
    $("studyProgress").hidden = !total;
    $("progressLabel").textContent = "本组进度";
    $("progressCount").textContent = completed + " / " + total;
    $("progressBar").max = total || 1;
    $("progressBar").value = completed;
}

function renderStudy() {
    const word = session.queue[session.index];
    session.answered = false;
    session.saved = false;
    session.saving = false;
    session.update = null;
    session.hintUsed = false;
    session.example = word ? exampleFor(word) : null;
    $("studyTitle").textContent = studyNames[session.mode];
    renderProgress();
    $("studyDone").hidden = !!word;
    $("studyCard").hidden = !word;
    if (!word) {
        $("doneTitle").textContent = session.queue.length ? "本组已完成" : session.mode === "review" ? "没有到期的词条" : "没有可背诵的新词";
        $("doneDescription").textContent = session.queue.length ? "已保存 " + session.queue.length + " 条学习记录。"
            : session.mode === "review" ? "到期的词条会出现在这里。" : "录入新词条后，就能继续背诵。";
        return;
    }
    $("studyPrompt").textContent = session.example ? "根据释义或例句写出英文" : "根据释义写出英文";
    $("studyTranslation").textContent = word.translation;
    $("studyInput").value = "";
    $("studyInput").readOnly = false;
    $("checkAnswer").hidden = false;
    $("feedback").hidden = true;
    $("ratingPanel").hidden = true;
    $("nextWord").hidden = true;
    $("retryRating").hidden = true;
    $("hintText").textContent = "";
    showError("studyError");
    renderStudyExample();
}

function renderStudyExample(reveal = false) {
    const example = session.example;
    $("studyExample").hidden = !example;
    if (!example) return;
    const { sentence, target, range, translation } = example;
    $("studySentence").textContent = sentence;
    $("studyExampleTranslation").textContent = translation || "";
    $("studyHint").hidden = reveal || session.hintUsed;
    if (!reveal) {
        const cloze = node("span", target.replace(/\S+/g, "____"), "cloze");
        cloze.setAttribute("aria-label", "填空");
        $("studySentence").replaceChildren(sentence.slice(0, range.start), cloze, sentence.slice(range.end));
    }
}

function checkAnswer() {
    const word = session?.queue[session.index];
    if (!word || session.answered) return;
    const input = $("studyInput");
    const answer = normalize(input.value);
    if (!answer) { input.focus(); return; }
    const alternate = session.example?.target;
    const ok = answer === normalize(word.word) || (!!alternate && answer === normalize(alternate));
    session.answered = true;
    input.readOnly = true;
    $("checkAnswer").hidden = true;
    $("feedbackStatus").textContent = ok ? "回答正确" : "正确答案";
    $("feedbackAnswer").textContent = alternate && normalize(alternate) !== normalize(word.word)
        ? word.word + " / " + alternate : word.word;
    $("feedback").classList.toggle("incorrect", !ok);
    $("feedback").hidden = false;
    renderStudyExample(true);
    if (!ok && (settings.ratingUI === "adaptive" || session.hintUsed)) {
        saveRating(1);
        return;
    }
    const allowed = session.hintUsed ? [2, 3]
        : settings.ratingUI === "adaptive" ? [2, 3, 4]
        : settings.ratingUI === "simple3" ? [1, 3, 4] : [1, 2, 3, 4];
    ratings.forEach(button => {
        button.hidden = !allowed.includes(Number(button.dataset.rating));
        button.disabled = false;
    });
    $("ratingPanel").hidden = false;
    ratings.find(button => !button.hidden)?.focus();
}

async function saveRating(rating) {
    const active = session;
    if (!active || !active.answered || active.saving || active.saved) return;
    const word = active.queue[active.index];
    active.saving = true;
    ratings.forEach(button => { button.disabled = true; });
    $("retryRating").hidden = true;
    showError("studyError");
    $("feedbackStatus").setAttribute("aria-busy", "true");
    try {
        if (!active.update) {
            const algorithm = window.FsrsAlgorithm;
            const legacy = word.status === "learning" && word.review_count > 0 && (!word.fsrs_state || !word.stability);
            const card = legacy ? { ...word, ...algorithm.initFromLegacy(word) } : word;
            active.update = algorithm.review(card, rating, settings);
        }
        const result = await request("PUT", word.id, active.update);
        Object.assign(word, result.word);
        active.saved = true;
        renderHome();
        if (!$("libraryPage").hidden) renderLibrary();
        if (session === active) {
            $("ratingPanel").hidden = true;
            $("nextWord").hidden = false;
            renderProgress();
            if (!$("studyPage").hidden) $("nextWord").focus();
        }
    } catch (error) {
        if (session === active) {
            showError("studyError", "学习记录未能保存。 " + error.message);
            $("retryRating").hidden = false;
            $("retryRating").onclick = () => saveRating(rating);
            if (!$("studyPage").hidden) $("retryRating").focus();
        }
    } finally {
        active.saving = false;
        if (session === active) $("feedbackStatus").removeAttribute("aria-busy");
    }
}

const ratings = [...document.querySelectorAll("[data-rating]")];
ratings.forEach(button => { button.onclick = () => saveRating(Number(button.dataset.rating)); });
$("nextWord").onclick = () => {
    if (!session.saved) return;
    session.index++;
    renderStudy();
    $(session.queue[session.index] ? "studyInput" : "studyTitle").focus();
};
$("studyHint").onclick = () => {
    session.hintUsed = true;
    $("studyHint").hidden = true;
    $("hintText").textContent = "首字母提示 " + session.example.target.replace(/\S+/g, word => {
        const chars = Array.from(word);
        return chars[0] + "_".repeat(chars.length - 1);
    });
};

document.querySelectorAll("[data-add]").forEach(button => { button.onclick = () => openEntry(); });
document.querySelectorAll("[data-close]").forEach(button => { button.onclick = () => button.closest("dialog").close(); });
$("importButton").onclick = openImport;
$("emptyImport").onclick = openImport;
$("downloadCsv").onclick = downloadCsvTemplate;
$("downloadJson").onclick = downloadJsonTemplate;
$("importFile").onchange = event => handleImportFile(event.target.files?.[0]);
$("importForm").onsubmit = event => { event.preventDefault(); importWords(); };
document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("cancel", event => {
        if (dialog.dataset.busy === "true") event.preventDefault();
    });
});
$("retryLoad").onclick = load;
$("settingsButton").onclick = openSettings;
$("reviewAction").onclick = () => startStudy("review");
$("reciteAction").onclick = () => startStudy("recite");
$("entryForm").onsubmit = event => { event.preventDefault(); saveEntry(); };
$("deleteForm").onsubmit = event => { event.preventDefault(); deleteWord(); };
$("answerForm").onsubmit = event => { event.preventDefault(); checkAnswer(); };
$("settingsForm").onsubmit = event => {
    event.preventDefault();
    settings.dailyCount = Number($("dailyCount").value);
    settings.desiredRetention = Number($("desiredRetention").value);
    settings.ratingUI = $("ratingUI").value;
    localStorage.setItem("wordbook_settings", JSON.stringify(settings));
    $("settingsDialog").close();
    if (words) renderHome();
    notify("已保存学习设置");
};
$("desiredRetention").oninput = updateRetentionLabel;
$("clearExample").onclick = () => {
    if (window.confirm("确定清除这个词条的例句？")) saveEntry(true);
};
$("useSelection").onclick = useSelectedText;
$("generateExample").onclick = generateExample;
$("exampleSentence").oninput = () => { selection = null; };
$("exampleTarget").oninput = () => { selection = null; };
$("searchWords").oninput = renderLibrary;
$("filterStatus").onchange = renderLibrary;
$("filterSort").onchange = renderLibrary;
window.addEventListener("hashchange", () => renderPage());
window.addEventListener("focus", () => {
    if (words && !document.querySelector("dialog[open]")) renderHome();
});
window.addEventListener("DOMContentLoaded", () => window.LA?.init({ id: "3ObMo9NLgqBCvJ53", ck: "3ObMo9NLgqBCvJ53" }));
load();
