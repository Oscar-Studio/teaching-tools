import { useCallback, useEffect, useState } from 'react';

/**
 * teaching-tools 子站的主题切换 hook
 * 跟 games/useHomeTheme 同结构，但：
 *   - 字段名 eduTheme
 *   - localStorage key 用 'oscar-edu-theme'
 *   - data-edu-theme 属性
 *   - 白名单 'classic' | 'notebook'
 */

export type EduTheme = 'classic' | 'notebook';

const STORAGE_KEY = 'oscar-edu-theme';
const DEFAULT_EDU_THEME: EduTheme = 'notebook';

const API_BASE_FALLBACK = 'https://api.oscarstudio.cn';

function isValidTheme(v: unknown): v is EduTheme {
  return v === 'classic' || v === 'notebook';
}

function readStoredTheme(): EduTheme {
  if (typeof localStorage === 'undefined') return DEFAULT_EDU_THEME;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isValidTheme(v)) return v;
  } catch { /* ignore */ }
  return DEFAULT_EDU_THEME;
}

function writeStoredTheme(t: EduTheme) {
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
}

function readToken(): string | null {
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(?:^|; )userToken=([^;]*)/);
    if (m) return decodeURIComponent(m[1]);
  }
  try {
    const ls = localStorage.getItem('ai_token') || localStorage.getItem('userToken');
    if (ls) return ls;
  } catch { /* ignore */ }
  return null;
}

function applyThemeAttr(t: EduTheme) {
  if (typeof document === 'undefined') return;
  const cur = document.documentElement.getAttribute('data-edu-theme');
  if (cur !== t) document.documentElement.setAttribute('data-edu-theme', t);
}

export function useHomeTheme(): [EduTheme, (t: EduTheme) => void] {
  const [theme, setThemeState] = useState<EduTheme>(readStoredTheme);

  // 1. 同步挂到 <html data-edu-theme>
  useEffect(() => {
    applyThemeAttr(theme);
  }, [theme]);

  // 2. 登录态下，把服务端 ui_config.eduTheme 拉下来覆盖本地缓存。
  useEffect(() => {
    let cancelled = false;
    const token = readToken();
    if (!token) return;

    (async () => {
      try {
        const apiBase = (window.API_BASE || API_BASE_FALLBACK) + '/api';
        const resp = await fetch(`${apiBase}/ui`, { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (cancelled || !data?.success) return;
        const remote = data?.ui?.eduTheme;
        if (isValidTheme(remote) && remote !== readStoredTheme()) {
          writeStoredTheme(remote);
          setThemeState(remote);
        }
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, []);

  const setTheme = useCallback((t: EduTheme) => {
    if (!isValidTheme(t)) return;
    setThemeState(t);
    writeStoredTheme(t);
    const token = readToken();
    if (token) {
      try {
        const apiBase = (window.API_BASE || API_BASE_FALLBACK) + '/api';
        fetch(`${apiBase}/ui`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({ eduTheme: t }),
        }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }
  }, []);

  return [theme, setTheme];
}
