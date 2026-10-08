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

  // 统一下拉菜单：trigger 点击展开，menu 内容由 buildItems() 动态生成，选中后回调 onSelect(value)
  // buildItems() -> [{ value, label, sub?, active?, muted? }, ...]
  window.dropdown = function (trigger, menu, buildItems, onSelect) {
    if (!trigger || !menu) return null;
    function open() {
      menu.innerHTML = '';
      var items = buildItems ? buildItems() : [];
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-opt' + (it.active ? ' active' : '') + (it.muted ? ' muted' : '');
        b.setAttribute('data-v', it.value == null ? '' : String(it.value));
        var lab = document.createElement('span');
        lab.className = 'mo-label';
        lab.textContent = it.label;
        b.appendChild(lab);
        if (it.sub) {
          var s = document.createElement('span');
          s.className = 'mo-sub';
          s.textContent = it.sub;
          b.appendChild(s);
        }
        var t = document.createElement('span');
        t.className = 'tick';
        t.textContent = '✓';
        b.appendChild(t);
        menu.appendChild(b);
      });
      menu.hidden = false;
      var r = trigger.getBoundingClientRect();
      var mr = menu.getBoundingClientRect();
      var left = Math.min(r.left, window.innerWidth - mr.width - 8);
      var top = r.bottom + 6;
      if (top + mr.height > window.innerHeight - 8) top = r.top - mr.height - 6;
      menu.style.left = Math.max(8, left) + 'px';
      menu.style.top = Math.max(8, top) + 'px';
    }
    function close() { menu.hidden = true; }
    trigger.addEventListener('click', function (e) { e.stopPropagation(); if (menu.hidden) open(); else close(); });
    menu.addEventListener('click', function (e) {
      var o = e.target.closest('.menu-opt');
      if (!o) return;
      close();
      if (onSelect) onSelect(o.getAttribute('data-v'));
    });
    document.addEventListener('click', function (e) {
      if (menu.hidden) return;
      if (trigger.contains(e.target) || menu.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
    return { open: open, close: close };
  };
})();
