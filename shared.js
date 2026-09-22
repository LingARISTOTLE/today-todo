// today-todo 共享工具（零依赖，供 index.html / goals.html 引用）
// 提供：$ / esc / escapeHtml / uid / applyTheme / toggleTheme
(function () {
  'use strict';

  window.$ = function (sel) { return document.querySelector(sel); };

  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // index.html 里历史用名，保留别名以免改动调用点
  window.escapeHtml = window.esc;

  window.uid = function () {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  };

  var THEME_KEY = 'today-todo-theme';
  window.applyTheme = function () {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!t && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  };
  window.toggleTheme = function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  };
})();
