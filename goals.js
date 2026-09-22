  var DIMS = ['内功', '战功'];
  var STATUS = { todo: '未开始', doing: '进行中', done: '已完成' };
  var DIM_KEY = 'today-todo-goals-dim';
  var state = { goals: [], quarter: '', dim: '内功', editingId: null };
  var openIds = {};


  /* ---- quarter ---- */
  function qParts(q) {
    var m = /^(\d{4})-Q([1-4])$/.exec(q);
    return m ? { y: +m[1], q: +m[2] } : null;
  }
  function currentQuarter() {
    var d = new Date();
    return d.getFullYear() + '-Q' + Math.ceil((d.getMonth() + 1) / 3);
  }
  function shiftQuarter(q, delta) {
    var p = qParts(q) || qParts(currentQuarter());
    var idx = p.y * 4 + (p.q - 1) + delta;
    return Math.floor(idx / 4) + '-Q' + (idx % 4 + 1);
  }
  function quarterRange(q) {
    var p = qParts(q);
    var start = (p.q - 1) * 3 + 1;
    return p.y + ' 年 ' + start + ' 月 - ' + (start + 2) + ' 月';
  }

  /* ---- data ---- */
  function loadGoals() {
    fetch('/api/goals', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
      .then(function (d) {
        state.goals = Array.isArray(d.goals) ? d.goals : [];
        render();
      })
      .catch(function () { state.goals = []; render(); });
  }
  function saveGoals() {
    fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goals: state.goals })
    }).catch(function () {});
  }

  /* ---- render ---- */
  function goalsInQuarter() {
    return state.goals.filter(function (g) { return g.quarter === state.quarter; });
  }
  function dimGoals() {
    return goalsInQuarter().filter(function (g) { return g.dimension === state.dim; });
  }
  function groupByCat(items) {
    items = items.slice().sort(function (a, b) {
      var o = { todo: 0, doing: 1, done: 2 };
      return (o[a.status] || 0) - (o[b.status] || 0) || (a.createdAt < b.createdAt ? -1 : 1);
    });
    var map = {};
    items.forEach(function (g) {
      var c = g.category || '其他';
      (map[c] = map[c] || []).push(g);
    });
    return map;
  }
  function goalHtml(g) {
    var docs = Array.isArray(g.docs) ? g.docs : [];
    return '<div class="goal ' + esc(g.status || 'todo') + (openIds[g.id] ? ' open' : '') + '" data-id="' + esc(g.id) + '">' +
      '<div class="g-top">' +
        statusPillHtml(g.status) +
        '<span class="title">' + esc(g.title) + '</span>' +
        '<div class="g-acts">' +
          '<button data-act="edit" title="编辑">编辑</button>' +
          '<button data-act="del" class="del" title="删除">删除</button>' +
        '</div>' +
      '</div>' +
      (g.link ? '<a class="link" href="' + esc(g.link) + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg> 打开文档 ↗</a>' : '') +
      (docs.length ? '<div><button class="docs-toggle" data-act="docs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg> ' + docs.length + ' 篇笔记 <span class="chev">▾</span></button></div>' : '') +
      (docs.length ? '<div class="docs">' + docs.map(function (d) {
        return '<a class="doclink" href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a>';
      }).join('') + '</div>' : '') +
      (g.note ? '<div class="note">' + esc(g.note) + '</div>' : '') +
    '</div>';
  }
  var COVERS = [
    'linear-gradient(135deg, #5b5bd6, #8b5cf6)',
    'linear-gradient(135deg, #0e7490, #22d3ee)',
    'linear-gradient(135deg, #16a34a, #4ade80)',
    'linear-gradient(135deg, #ea580c, #fbbf24)',
    'linear-gradient(135deg, #db2777, #f472b6)',
    'linear-gradient(135deg, #7c3aed, #a78bfa)'
  ];
  function coverChar(title) {
    var t = String(title || '').replace(/^《/, '').replace(/》$/, '').trim();
    return t ? t.charAt(0) : '书';
  }
  function stripBookPrefix(t, book) {
    var s = String(t || ''), b = String(book || '').trim();
    return (b && s.indexOf(b) === 0) ? s.slice(b.length) : s;
  }
  function bookHtml(g, idx) {
    var docs = Array.isArray(g.docs) ? g.docs : [];
    var ch = docs.map(function (d) {
      return '<a class="chapter" href="' + esc(d.url) + '" target="_blank" rel="noopener">' +
        '<span class="ch-title">' + esc(stripBookPrefix(d.title, g.title)) + '</span>' +
        '<span class="ch-link">↗</span>' +
      '</a>';
    }).join('');
    return '<div class="book goal ' + esc(g.status || 'todo') + (openIds[g.id] ? ' open' : '') + '" data-id="' + esc(g.id) + '">' +
      '<div class="book-head" data-act="fold" title="展开 / 折叠章节">' +
        '<div class="cover" style="background:' + COVERS[idx % COVERS.length] + '"><span>' + esc(coverChar(g.title)) + '</span></div>' +
        '<div class="book-meta">' +
          '<div class="book-title">' + esc(g.title) + '</div>' +
          '<div class="book-sub">' + docs.length + ' 章读书笔记<i class="fold">▾</i>' +
            (g.link ? ' · <a href="' + esc(g.link) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
          '</div>' +
        '</div>' +
        statusPillHtml(g.status) +
      '</div>' +
      '<div class="chapters"><div class="ch-inner">' + ch + '</div></div>' +
      '<div class="book-foot">' +
        '<button data-act="edit">编辑</button>' +
        '<button data-act="del" class="del">删除</button>' +
      '</div>' +
    '</div>';
  }
  function render() {
    var p = qParts(state.quarter);
    $('#qTitle').textContent = p.y + ' · Q' + p.q;
    $('#qRange').textContent = quarterRange(state.quarter);

    var inQ = goalsInQuarter();
    var nN = inQ.filter(function (g) { return g.dimension === '内功'; }).length;
    var nZ = inQ.filter(function (g) { return g.dimension === '战功'; }).length;
    $('#nNeigong').textContent = nN;
    $('#nZhangong').textContent = nZ;

    Array.prototype.forEach.call(document.querySelectorAll('.dimtab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-dim') === state.dim);
    });

    var items = dimGoals();
    var done = items.filter(function (g) { return g.status === 'done'; }).length;
    $('#dimProgress').style.width = items.length ? Math.round(done / items.length * 100) + '%' : '0';
    $('#progLabel').innerHTML = state.dim + ' · <b>' + done + '</b> / ' + items.length + ' 完成';

    var map = groupByCat(items);
    var cats = Object.keys(map);
    var html = '';
    if (!cats.length) {
      html = '<div class="empty"><span class="big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></span><p>本季度暂无「' + state.dim + '」目标</p><button class="addbtn" data-act="empty-add">＋ 添加第一条目标</button></div>';
    } else {
      cats.forEach(function (c) {
        html += '<div class="cat"><div class="cat-head"><span class="cat-name">' + esc(c) + '</span>' +
          '<span class="cat-count">' + map[c].length + ' 条</span></div>' +
          map[c].map(function (g, i) { return g.category === '书籍阅读' ? bookHtml(g, i) : goalHtml(g); }).join('') + '</div>';
      });
    }
    $('#goals').innerHTML = html;
  }

  /* ---- actions ---- */
  var statusMenuEl = null, statusMenuFor = null;
  function statusPillHtml(status) {
    status = status || 'todo';
    var name = status === 'done' ? '已完成' : (status === 'doing' ? '进行中' : '未开始');
    return '<button class="status-pill ' + esc(status) + '" data-act="status" title="切换状态">' + name + '<i class="chev">▾</i></button>';
  }
  function openStatusMenu(id, anchor) {
    var g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return;
    statusMenuFor = id;
    Array.prototype.forEach.call(statusMenuEl.querySelectorAll('.status-opt'), function (o) {
      o.classList.toggle('active', o.getAttribute('data-s') === g.status);
    });
    statusMenuEl.hidden = false;
    var r = anchor.getBoundingClientRect();
    var mr = statusMenuEl.getBoundingClientRect();
    var left = Math.min(r.left, window.innerWidth - mr.width - 8);
    var top = r.bottom + 6;
    if (top + mr.height > window.innerHeight - 8) top = r.top - mr.height - 6;
    statusMenuEl.style.left = Math.max(8, left) + 'px';
    statusMenuEl.style.top = Math.max(8, top) + 'px';
  }
  function closeStatusMenu() { statusMenuEl.hidden = true; statusMenuFor = null; }
  function setStatus(id, status) {
    var g = state.goals.find(function (x) { return x.id === id; });
    if (!g) return;
    g.status = status;
    saveGoals(); render();
    closeStatusMenu();
  }
  function openForm(id) {
    state.editingId = id || null;
    $('#formTitle').textContent = id ? '编辑目标' : '添加目标';
    var g = id ? state.goals.find(function (x) { return x.id === id; }) : null;
    $('#fDim').value = g ? (g.dimension || state.dim) : state.dim;
    $('#fCat').value = g ? (g.category || '') : '';
    $('#fTitle').value = g ? (g.title || '') : '';
    $('#fLink').value = g ? (g.link || '') : '';
    $('#fStatus').value = g ? (g.status || 'todo') : 'todo';
    $('#fNote').value = g ? (g.note || '') : '';
    $('#mask').hidden = false;
    $('#fTitle').focus();
  }
  function closeForm() { $('#mask').hidden = true; state.editingId = null; }
  function submitForm(e) {
    e.preventDefault();
    var title = $('#fTitle').value.trim();
    if (!title) { $('#fTitle').focus(); return; }
    var data = {
      dimension: $('#fDim').value || '内功',
      category: $('#fCat').value.trim(),
      title: title,
      link: $('#fLink').value.trim(),
      status: $('#fStatus').value || 'todo',
      note: $('#fNote').value.trim()
    };
    if (state.editingId) {
      var g = state.goals.find(function (x) { return x.id === state.editingId; });
      if (g) Object.assign(g, data);
    } else {
      state.goals.push(Object.assign({
        id: uid(), quarter: state.quarter, createdAt: new Date().toISOString()
      }, data));
    }
    saveGoals(); render(); closeForm();
  }
  function delGoal(id) {
    state.goals = state.goals.filter(function (x) { return x.id !== id; });
    saveGoals(); render();
  }

  /* ---- theme ---- */

  /* ---- events ---- */
  function init() {
    state.quarter = currentQuarter();
    statusMenuEl = $('#statusMenu');
    try { state.dim = localStorage.getItem(DIM_KEY) || '内功'; } catch (e) {}

    $('#qPrev').addEventListener('click', function () { state.quarter = shiftQuarter(state.quarter, -1); render(); });
    $('#qNext').addEventListener('click', function () { state.quarter = shiftQuarter(state.quarter, 1); render(); });
    $('#qToday').addEventListener('click', function () { state.quarter = currentQuarter(); render(); });
    $('#addBtn').addEventListener('click', function () { openForm(null); });
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#fCancel').addEventListener('click', closeForm);
    $('#form').addEventListener('submit', submitForm);
    $('#mask').addEventListener('click', function (e) { if (e.target === $('#mask')) closeForm(); });

    document.querySelector('.dimtabs').addEventListener('click', function (e) {
      var b = e.target.closest('.dimtab');
      if (!b) return;
      state.dim = b.getAttribute('data-dim');
      try { localStorage.setItem(DIM_KEY, state.dim); } catch (err) {}
      render();
    });

    $('#goals').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="empty-add"]')) { openForm(null); return; }
      var card = e.target.closest('.goal');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'status') openStatusMenu(id, btn);
      else if (act === 'fold' || act === 'docs') { openIds[id] = !openIds[id]; render(); }
      else if (act === 'edit') openForm(id);
      else if (act === 'del') { if (confirm('删除这条目标？')) delGoal(id); }
    });

    statusMenuEl.addEventListener('click', function (e) {
      var o = e.target.closest('.status-opt');
      if (!o) return;
      setStatus(statusMenuFor, o.getAttribute('data-s'));
    });
    document.addEventListener('click', function (e) {
      if (!statusMenuEl.hidden && !e.target.closest('.status-pill') && !e.target.closest('#statusMenu')) closeStatusMenu();
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeForm(); });

    applyTheme();
    loadGoals();
  }
  init();