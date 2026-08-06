(function () {
  'use strict';

  const LANG_COOKIE = 'fireguard_lang';
  const THEME_COOKIE = 'fireguard_theme';
  const MAX_AGE = 60 * 60 * 24 * 365; // 1 year
  const LANGS = ['es', 'en', 'it'];

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${MAX_AGE}; path=/; SameSite=Lax`;
  }

  function getPreferredLang() {
    const c = getCookie(LANG_COOKIE);
    return LANGS.includes(c) ? c : 'es';
  }

  function setPreferredLang(lang) {
    setCookie(LANG_COOKIE, lang);
  }

  // null means "no explicit preference yet" (falls back to OS setting).
  function getPreferredTheme() {
    const c = getCookie(THEME_COOKIE);
    return c === 'light' || c === 'dark' ? c : null;
  }

  function setPreferredTheme(theme) {
    setCookie(THEME_COOKIE, theme);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }

  function effectiveTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  window.FireGuardPrefs = {
    getPreferredLang,
    setPreferredLang,
    getPreferredTheme,
    setPreferredTheme,
    applyTheme,
    effectiveTheme,
  };
})();
