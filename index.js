  'use strict';

  var STORE_KEY = 'today-todo-v1';
  var PRIO = { 0: 'p0', 1: 'p1', 2: 'p2', 3: 'p3' };
  var PRIO_NAME = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3' };
  var PRIO_FULL = { 0: '紧急', 1: '高', 2: '中', 3: '低' };
  var WDAY = ['日', '一', '二', '三', '四', '五', '六'];

  // 2026 年中国法定节假日（国办发明电〔2025〕7号，2025-11-04）
  var HOLIDAYS = {
    '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
    '2026-02-15': '春节', '2026-02-16': '春节', '2026-02-17': '春节', '2026-02-18': '春节',
    '2026-02-19': '春节', '2026-02-20': '春节', '2026-02-21': '春节', '2026-02-22': '春节', '2026-02-23': '春节',
    '2026-04-04': '清明', '2026-04-05': '清明', '2026-04-06': '清明',
    '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节', '2026-05-04': '劳动节', '2026-05-05': '劳动节',
    '2026-06-19': '端午', '2026-06-20': '端午', '2026-06-21': '端午',
    '2026-09-25': '中秋', '2026-09-26': '中秋', '2026-09-27': '中秋',
    '2026-10-01': '国庆', '2026-10-02': '国庆', '2026-10-03': '国庆', '2026-10-04': '国庆',
    '2026-10-05': '国庆', '2026-10-06': '国庆', '2026-10-07': '国庆'
  };
  // 2026 年调休上班日
  var WORKDAYS = {
    '2026-01-04': true, '2026-02-14': true, '2026-02-28': true,
    '2026-05-09': true, '2026-09-20': true, '2026-10-10': true
  };

  // 动态节假日：优先从 holiday-cn 拉取，失败回退到上面的 2026 硬编码
  var holidayCache = { 2026: { holidays: HOLIDAYS, workdays: WORKDAYS } };
  var holidayLoading = {};
  function fetchHolidays(year) {
    if (holidayLoading[year]) return Promise.resolve();
    holidayLoading[year] = true;
    var url = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + year + '.json';
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var h = {}, w = {};
        (d.days || []).forEach(function (day) {
          if (day.isOffDay) h[day.date] = day.name; else w[day.date] = true;
        });
        holidayCache[year] = { holidays: h, workdays: w };
      })
      .catch(function () {
        if (!holidayCache[year]) holidayCache[year] = { holidays: {}, workdays: {} };
      })
      .then(function () { holidayLoading[year] = false; });
  }
  function warmHolidays() {
    fetchHolidays(state.calYear);
    fetchHolidays(state.calYear + 1);
  }

  var state = {
    tasks: [],
    goals: [],
    sortMode: 'priority', // priority | due | created | late | custom
    view: 'list',         // list | cal
    filter: 'all',        // all | open | today | late | done
    calYear: 0, calMonth: 0, selectedDay: '',
    editingId: null, editingPrio: 2,
    settings: {
      base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat',
      projects: ['架构师Agent', 'MAF数据迁移', '稽查虾'],
      natures: ['探索类', '交付类', '学习类']
    }
  };

  var el = {
    input: $('#input'), dateLabel: $('#dateLabel'), syncLabel: $('#syncLabel'),
    openList: $('#openList'), doneList: $('#doneList'),
    openLabel: $('#openLabel'), doneLabel: $('#doneLabel'),
    statOpenN: $('#statOpenN'), statTodayN: $('#statTodayN'),
    statLateN: $('#statLateN'), statDoneN: $('#statDoneN'),
    progressBar: $('#progressBar'), toast: $('#toast'),
    viewList: $('#viewList'), viewCal: $('#viewCal'),
    tabList: $('#tabList'), tabCal: $('#tabCal'),
    calTitle: $('#calTitle'), calGrid: $('#calGrid'),
    calDayHead: $('#calDayHead'), calDayList: $('#calDayList'),
    editMask: $('#editMask'),
    editTitle: $('#editTitle'), editProject: $('#editProject'),
    projectsList: $('#projectsList'), editDue: $('#editDue'),
    editPrio: $('#editPrio'), editNature: $('#editNature'), naturesList: $('#naturesList'),
    editGoal: $('#editGoal'),
    settingsMask: $('#settingsMask'),
    cfgBase: $('#cfgBase'), cfgKey: $('#cfgKey'), cfgModel: $('#cfgModel')
  };

  /* ---------- utils ---------- */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function niceDate() {
    var d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + WDAY[d.getDay()];
  }
  function dayDiff(fromStr, toStr) {
    var a = fromStr.split('-').map(Number), b = toStr.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  function shiftDay(dayStr, delta) {
    var p = dayStr.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function weekdayOf(dayStr) {
    var p = dayStr.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  }
  function fmtDue(dayStr) {
    var m = parseInt(dayStr.slice(5, 7), 10), d = parseInt(dayStr.slice(8, 10), 10);
    var y = dayStr.slice(0, 4);
    return (y === todayStr().slice(0, 4)) ? (m + '月' + d + '日') : (y + '年' + m + '月' + d + '日');
  }
  function fmtDateCN(dayStr) {
    var m = parseInt(dayStr.slice(5, 7), 10), d = parseInt(dayStr.slice(8, 10), 10);
    return m + '月' + d + '日 · 周' + WDAY[weekdayOf(dayStr)];
  }
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 1800);
  }

  /* ---------- persistence ---------- */
  function normalizeTask(t) {
    if (typeof t.priority !== 'number' || t.priority < 0 || t.priority > 3) t.priority = 2;
    if (typeof t.project !== 'string') t.project = '';
    if (typeof t.nature !== 'string') t.nature = '';
    if (typeof t.due !== 'string' || !t.due) t.due = t.createdDay || todayStr();
    if (typeof t.goalId !== 'string') t.goalId = '';
    return t;
  }
  function applyState(d) {
    state.tasks = (Array.isArray(d.tasks) ? d.tasks : []).map(normalizeTask);
    monthCache = {}; // 数据刷新后清掉归档缓存，保证回读最新
    state.goals = Array.isArray(d.goals) ? d.goals : [];
    if (d.settings) {
      Object.assign(state.settings, d.settings);
      if (!Array.isArray(state.settings.projects)) state.settings.projects = ['架构师Agent', 'MAF数据迁移', '稽查虾'];
      if (!Array.isArray(state.settings.natures)) state.settings.natures = ['探索类', '交付类', '学习类'];
    }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) applyState(JSON.parse(raw));
    } catch (e) { state.tasks = []; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    try {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).catch(function () {});
    } catch (e) {}
  }
  function loadAndRender() {
    fetch('/api/state', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-server'); return r.json(); })
      .then(function (d) { applyState(d); })
      .catch(function () { loadLocal(); })
      .then(function () { initCalendar(); setView(state.view); warmHolidays(); updateSync(); el.input.focus(); });
  }
  function refresh() {
    fetch('/api/state', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-server'); return r.json(); })
      .then(function (d) {
        applyState(d);
        render();
        updateSync();
      })
      .catch(function () {});
  }
  function updateSync() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.syncLabel.textContent = '每 5 分钟自动刷新 · 上次 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- task ops ---------- */
  function addTasks(titles) {
    var today = todayStr();
    var added = 0;
    titles.forEach(function (t) {
      t = (t || '').trim();
      if (!t) return;
      state.tasks.unshift({
        id: uid(), title: t, priority: 2, project: '', nature: '', due: today,
        createdDay: today, createdAt: new Date().toISOString(),
        done: false, doneAt: null
      });
      added++;
    });
    if (added) { save(); render(); }
    return added;
  }
  function toggleDone(id) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? new Date().toISOString() : null;
    save(); render();
  }
  var prioMenuEl = $('#prioMenu');
  var prioMenuFor = null;
  function openPrioMenu(id, anchorEl) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    prioMenuFor = id;
    Array.prototype.forEach.call(prioMenuEl.querySelectorAll('.prio-opt'), function (o) {
      o.classList.toggle('active', parseInt(o.getAttribute('data-p'), 10) === t.priority);
    });
    prioMenuEl.hidden = false;
    var r = anchorEl.getBoundingClientRect();
    var mr = prioMenuEl.getBoundingClientRect();
    var left = Math.min(r.left, window.innerWidth - mr.width - 8);
    var top = r.bottom + 6;
    if (top + mr.height > window.innerHeight - 8) top = r.top - mr.height - 6;
    prioMenuEl.style.left = Math.max(8, left) + 'px';
    prioMenuEl.style.top = Math.max(8, top) + 'px';
  }
  function closePrioMenu() { prioMenuEl.hidden = true; prioMenuFor = null; }
  function setPriority(id, p) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.priority = p;
    save(); render();
    closePrioMenu();
  }
  function removeTask(id) {
    state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
    save(); render();
  }
  function updateTitle(id, title) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    title = (title || '').trim();
    if (!title) { removeTask(id); return; }
    t.title = title;
    save(); render();
  }
  function clearDone() {
    state.tasks = state.tasks.filter(function (x) { return !x.done; });
    save(); render();
  }

  /* ---------- sorting ---------- */
  function sortUndone(list) {
    var m = state.sortMode;
    var arr = list.slice();
    if (m === 'created') arr.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    else if (m === 'due') arr.sort(function (a, b) {
      if (!a.due && !b.due) return a.priority - b.priority;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : (a.due > b.due ? 1 : (a.priority - b.priority));
    });
    else if (m === 'late') arr.sort(function (a, b) {
      var today = todayStr();
      var dl = dayDiff(b.due, today) - dayDiff(a.due, today);
      if (dl !== 0) return dl;
      return a.priority - b.priority;
    });
    else arr.sort(function (a, b) { return a.priority - b.priority; });
    return arr;
  }

  /* ---------- render ---------- */
  function updateStats() {
    var today = todayStr();
    var undone = state.tasks.filter(function (t) { return !t.done; });
    var done = state.tasks.filter(function (t) { return t.done; });
    var todayCount = undone.filter(function (t) { return t.createdDay === today; }).length;
    var lateCount = undone.filter(function (t) { return dayDiff(t.due, today) > 0; }).length;
    el.dateLabel.textContent = niceDate();
    el.statOpenN.textContent = undone.length;
    el.statTodayN.textContent = todayCount;
    el.statLateN.textContent = lateCount;
    el.statDoneN.textContent = done.length;
    var total = undone.length + done.length;
    el.progressBar.style.width = total ? Math.round(done.length / total * 100) + '%' : '0%';
  }
  function render() {
    updateStats();
    syncFilter();
    if (state.view === 'cal') renderCalendar();
    else renderList();
  }
  function renderList() {
    var today = todayStr();
    var f = state.filter;
    var undone = state.tasks.filter(function (t) { return !t.done; });
    var done = state.tasks.filter(function (t) { return t.done; });

    var primary = [], secondary = [];
    var primaryTitle, secondaryTitle = '已完成 · ' + done.length;

    if (f === 'done') {
      primary = done;
      primaryTitle = '已完成 · ' + done.length;
    } else {
      if (f === 'today') primary = undone.filter(function (t) { return t.createdDay === today; });
      else if (f === 'late') primary = undone.filter(function (t) { return dayDiff(t.due, today) > 0; });
      else primary = undone;
      var names = { all: '未完成', open: '未完成', today: '今日', late: '拖延' };
      primaryTitle = names[f] + ' · ' + primary.length;
      if (f === 'all') secondary = done;
    }

    var emptyMsg;
    if (f === 'done') emptyMsg = '<div class="empty"><span class="big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></span><p>还没有完成的任务</p></div>';
    else if (f !== 'all') emptyMsg = '<div class="empty"><span class="big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span><p>没有符合条件的任务</p></div>';
    else emptyMsg = '<div class="empty"><span class="big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/></svg></span><p>今天都清空了</p><span class="sub">点上方输入框，添加新任务</span></div>';

    el.openLabel.textContent = primaryTitle;
    el.openList.innerHTML = (f === 'done' ? primary : sortUndone(primary)).map(taskHtml).join('') || emptyMsg;
    el.doneList.innerHTML = secondary.map(taskHtml).join('');
    el.doneLabel.style.display = secondary.length ? 'flex' : 'none';
    el.doneLabel.querySelector('span').textContent = secondaryTitle;
  }
  function setFilter(f) {
    state.filter = (state.filter === f) ? 'all' : f;
    if (state.view !== 'list') setView('list');
    else render();
  }
  function syncFilter() {
    Array.prototype.forEach.call(document.querySelectorAll('.stats .stat'), function (s) {
      s.classList.toggle('active', s.getAttribute('data-filter') === state.filter);
    });
  }

  function taskHtml(t) {
    var today = todayStr();
    var overdueDays = dayDiff(t.due, today);
    var chips = [];
    if (t.project) chips.push('<span class="tag proj">' + escapeHtml(t.project) + '</span>');
    if (t.nature) chips.push('<span class="tag nature">' + escapeHtml(t.nature) + '</span>');
    if (t.goalId) {
      var _g = state.goals.find(function (x) { return x.id === t.goalId; });
      chips.push('<a class="tag goal" href="/goals" target="_blank" title="查看中期目标"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>' + escapeHtml(_g ? _g.title : '目标') + '</a>');
    }
    if (t.due) {
      var dueDiff = dayDiff(today, t.due);
      var dueCls = (!t.done && dueDiff < 0) ? 'tag due overdue' : 'tag due';
      chips.push('<span class="' + dueCls + '">截止 ' + fmtDue(t.due) + '</span>');
    }
    if (!t.done) {
      if (overdueDays >= 1) chips.push('<span class="tag late">逾期 ' + overdueDays + ' 天</span>');
    } else {
      chips.push('<span class="tag done-tag">已完成</span>');
    }
    return (
      '<div class="task ' + PRIO[t.priority] + (t.done ? ' done' : '') + '" data-id="' + t.id + '">' +
        '<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
        '<span class="prio ' + PRIO[t.priority] + '" title="点击选择优先级（当前 ' + PRIO_NAME[t.priority] + ' ' + PRIO_FULL[t.priority] + '）">' + PRIO_NAME[t.priority] + '<i class="chev">▾</i></span>' +
        '<div class="body">' +
          '<div class="task-title">' + escapeHtml(t.title) + '</div>' +
          '<div class="meta">' + chips.join('') + '</div>' +
        '</div>' +
        '<button class="task-edit" title="编辑标签"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.83z"/><path d="M7 7h.01"/></svg></button>' +
        '<button class="task-del" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>' +
      '</div>'
    );
  }

  /* ---------- calendar ---------- */
  function initCalendar() {
    var today = todayStr();
    var p = today.split('-').map(Number);
    if (!state.calYear) { state.calYear = p[0]; state.calMonth = p[1] - 1; }
    if (state.calYear === p[0] && state.calMonth === p[1] - 1) {
      state.selectedDay = today;
    } else {
      state.selectedDay = state.calYear + '-' + pad(state.calMonth + 1) + '-01';
    }
  }
  var monthCache = {}; // 'YYYY-MM' -> [tasks]（已归档月份的归档回读缓存）
  function currentMonthKey() {
    var p = todayStr().split('-').map(Number);
    return p[0] + '-' + pad(p[1]);
  }
  function calMonthKey() {
    return state.calYear + '-' + pad(state.calMonth + 1);
  }
  function tasksForCalMonth() {
    var key = calMonthKey();
    if (key === currentMonthKey()) return state.tasks; // 当月实时可编辑
    return monthCache[key] || [];                        // 其它月读归档缓存
  }
  function tasksDueOn(dayStr) {
    var list = tasksForCalMonth().filter(function (t) { return t.due === dayStr; });
    var undone = list.filter(function (t) { return !t.done; });
    var done = list.filter(function (t) { return t.done; });
    return sortUndone(undone).concat(done);
  }
  function renderCalendar() {
    var key = calMonthKey();
    if (key === currentMonthKey() || monthCache[key]) {
      drawCalendar();
      return;
    }
    drawCalendar(); // 先画空，异步回读归档后重画
    fetch('/api/month?month=' + key, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
      .then(function (d) {
        monthCache[key] = (d && Array.isArray(d.tasks)) ? d.tasks : [];
        if (key === calMonthKey()) drawCalendar();
      })
      .catch(function () {
        monthCache[key] = [];
        if (key === calMonthKey()) drawCalendar();
      });
  }
  function drawCalendar() {
    var y = state.calYear, m = state.calMonth;
    el.calTitle.textContent = y + '年' + (m + 1) + '月';
    var hd = holidayCache[y] || { holidays: {}, workdays: {} };
    var first = new Date(Date.UTC(y, m, 1));
    var startOffset = (first.getUTCDay() + 6) % 7;
    var daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var cells = [];
    for (var i = 0; i < startOffset; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    var today = todayStr();
    var html = '<div class="cal-weekday">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    html += '<div class="cal-days">';
    cells.forEach(function (dn) {
      if (dn === null) { html += '<div class="cal-cell blank"></div>'; return; }
      var dayStr = y + '-' + pad(m + 1) + '-' + pad(dn);
      var wd = weekdayOf(dayStr);
      var isWeekend = (wd === 0 || wd === 6);
      var hName = hd.holidays[dayStr];
      var isMakeup = hd.workdays[dayStr];
      var cls = ['cal-cell'];
      if (hName) cls.push('holiday');
      else if (isMakeup) cls.push('makeup');
      else if (isWeekend) cls.push('weekend');
      if (dayStr === today) cls.push('today');
      if (dayStr === state.selectedDay) cls.push('selected');
      var sub = '';
      if (hName) sub = (hd.holidays[shiftDay(dayStr, -1)] === hName) ? '休' : hName;
      else if (isMakeup) sub = '班';
      else if (isWeekend) sub = '休';
      var dueTasks = tasksDueOn(dayStr);
      var cnt = dueTasks.length;
      var doneCnt = dueTasks.filter(function (t) { return t.done; }).length;
      var badge = cnt
        ? '<span class="cal-badge" title="共 ' + cnt + ' · 已完成 ' + doneCnt + ' · 剩余 ' + (cnt - doneCnt) + '">' +
          '<i class="cb-total">' + cnt + '</i>' +
          '<i class="cb-done">' + doneCnt + '</i>' +
          '<i class="cb-left">' + (cnt - doneCnt) + '</i>' +
          '</span>'
        : '';
      html += '<div class="' + cls.join(' ') + '" data-day="' + dayStr + '">' +
        '<span class="cal-num">' + dn + '</span>' +
        (sub ? '<span class="cal-sub">' + sub + '</span>' : '') +
        badge + '</div>';
    });
    html += '</div>';
    el.calGrid.innerHTML = html;
    renderCalDay();
    if (!holidayCache[y]) {
      fetchHolidays(y).then(function () {
        if (state.view === 'cal' && state.calYear === y) renderCalendar();
      });
    }
  }
  function renderCalDay() {
    var day = state.selectedDay || todayStr();
    var tasks = tasksDueOn(day);
    var extra = '';
    var y = parseInt(day.slice(0, 4), 10);
    var hd = holidayCache[y] || { holidays: {}, workdays: {} };
    var hName = hd.holidays[day];
    if (hName) extra = ' · ' + hName;
    else if (hd.workdays[day]) extra = ' · 调休上班';
    var dayDone = tasks.filter(function (t) { return t.done; }).length;
    el.calDayHead.textContent = fmtDateCN(day) + extra + ' · 共 ' + tasks.length + ' · 已完成 ' + dayDone + ' · 剩余 ' + (tasks.length - dayDone);
    el.calDayList.innerHTML = tasks.map(taskHtml).join('')
      || '<div class="empty small">当天没有截止任务（点击其他日期查看）</div>';
  }
  function selectDay(dayStr) {
    state.selectedDay = dayStr;
    renderCalendar();
  }

  /* ---------- tag editor modal ---------- */
  function refreshDatalists() {
    el.projectsList.innerHTML = state.settings.projects.map(function (p) { return '<option value="' + escapeHtml(p) + '">'; }).join('');
    el.naturesList.innerHTML = state.settings.natures.map(function (n) { return '<option value="' + escapeHtml(n) + '">'; }).join('');
  }
  function refreshGoalOptions() {
    var opts = '<option value="">（不关联）</option>';
    state.goals.forEach(function (g) {
      opts += '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.title) +
        ' · ' + escapeHtml(g.dimension || '') + ' · ' + escapeHtml(g.quarter || '') + '</option>';
    });
    el.editGoal.innerHTML = opts;
  }
  function openEdit(id) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    state.editingId = id;
    state.editingPrio = t.priority;
    refreshDatalists();
    refreshGoalOptions();
    el.editTitle.value = t.title;
    el.editProject.value = t.project || '';
    el.editDue.value = t.due || '';
    el.editNature.value = t.nature || '';
    el.editGoal.value = t.goalId || '';
    syncPrioButtons();
    el.editMask.classList.add('show');
  }
  function syncPrioButtons() {
    Array.prototype.forEach.call(el.editPrio.querySelectorAll('.pbtn'), function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-p'), 10) === state.editingPrio);
    });
  }
  function closeEdit() { el.editMask.classList.remove('show'); state.editingId = null; }
  function saveEdit() {
    var t = state.tasks.find(function (x) { return x.id === state.editingId; });
    if (!t) { closeEdit(); return; }
    t.title = el.editTitle.value.trim() || t.title;
    t.project = el.editProject.value.trim();
    t.nature = el.editNature.value.trim();
    t.due = el.editDue.value || todayStr();
    t.priority = state.editingPrio;
    t.goalId = el.editGoal.value || '';
    if (t.project && state.settings.projects.indexOf(t.project) < 0) state.settings.projects.push(t.project);
    if (t.nature && state.settings.natures.indexOf(t.nature) < 0) state.settings.natures.push(t.nature);
    save(); closeEdit(); render();
  }

  /* ---------- event delegation ---------- */
  function bindList(elList) {
    elList.addEventListener('click', function (e) {
      var task = e.target.closest('.task');
      if (!task) return;
      var id = task.getAttribute('data-id');
      if (e.target.closest('.check')) toggleDone(id);
      else if (e.target.closest('.prio')) openPrioMenu(id, e.target.closest('.prio'));
      else if (e.target.closest('.task-del')) removeTask(id);
      else if (e.target.closest('.task-edit') || e.target.closest('.meta')) openEdit(id);
    });
    elList.addEventListener('dblclick', function (e) {
      var titleEl = e.target.closest('.task-title');
      if (!titleEl) return;
      var task = titleEl.closest('.task');
      var id = task.getAttribute('data-id');
      var t = state.tasks.find(function (x) { return x.id === id; });
      if (!t || t.done) return;
      var inp = document.createElement('input');
      inp.className = 'edit-input';
      inp.value = t.title;
      titleEl.replaceWith(inp);
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      var done = false;
      function commit() {
        if (done) return; done = true;
        updateTitle(id, inp.value);
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') { done = true; render(); }
      });
    });
  }

  /* ---------- input ---------- */
  function handleInput() {
    var v = el.input.value;
    var lines = v.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    el.input.value = '';
    autoGrow();
    if (lines.length) { addTasks(lines); }
  }
  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 160) + 'px';
  }

  /* ---------- view switching ---------- */
  function setView(v) {
    state.view = v;
    el.tabList.classList.toggle('active', v === 'list');
    el.tabCal.classList.toggle('active', v === 'cal');
    el.viewList.style.display = v === 'list' ? '' : 'none';
    el.viewCal.style.display = v === 'cal' ? '' : 'none';
    render();
  }

  /* ---------- sort button ---------- */
  var SORT_LABEL = { priority: '优先级', due: '截止日期', created: '创建时间', late: '拖延最久', custom: '自定义顺序' };
  function cycleSort() {
    var keys = ['priority', 'due', 'created', 'late'];
    var i = keys.indexOf(state.sortMode);
    state.sortMode = keys[i < 0 ? 0 : (i + 1) % keys.length];
    render();
    toast('排序：' + SORT_LABEL[state.sortMode]);
  }

  /* ---------- AI priority ---------- */
  function aiSort() {
    var s = state.settings;
    if (!s.key) { openSettings(); toast('先配置 API Key 才能用 AI 排优先级'); return; }
    var undone = state.tasks.filter(function (t) { return !t.done; });
    if (undone.length < 2) { toast('至少需要 2 个未完成任务'); return; }
    var today = todayStr();
    var lines = undone.map(function (t, i) {
      var late = dayDiff(t.due, today);
      var lateTxt = late > 0 ? '逾期 ' + late + ' 天' : '未逾期';
      return '[' + (i + 1) + '] ' + t.title + '（优先级:' + PRIO_NAME[t.priority] + '，' + lateTxt + '）';
    }).join('\n');
    var sys = '你是时间管理助手。用户一天并行任务很多，容易漏掉。请综合截止压力（逾期天数）、已有优先级、事情大小，给出建议的执行顺序。只输出一个 JSON 数组，元素为任务序号（1 起始），按「先做→后做」排列，必须包含且只包含所有序号一次。不要输出任何解释或其他文字。';
    toast('AI 正在排优先级…');
    fetch(s.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
      body: JSON.stringify({ model: s.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: lines }], temperature: 0.3, stream: false })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)); });
      return r.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('AI 返回为空');
      applyOrder(parseOrder(content, undone.length), undone);
      toast('已按 AI 建议重新排序');
    }).catch(function (e) {
      toast('AI 调用失败：' + (e && e.message ? e.message : e));
    });
  }
  function parseOrder(text, n) {
    var m = text.match(/\[[\s\S]*?\]/);
    var arr = [];
    if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = []; } }
    if (!Array.isArray(arr) || arr.length !== n) {
      var nums = text.match(/\d+/g);
      if (nums) arr = nums.map(Number).filter(function (x) { return x >= 1 && x <= n; });
    }
    var seen = {}, order = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; order.push(x); } });
    for (var i = 1; i <= n; i++) if (!seen[i]) order.push(i);
    return order;
  }
  function applyOrder(order, undone) {
    var mapped = order.map(function (idx) { return undone[idx - 1]; });
    var rest = state.tasks.filter(function (t) { return t.done; });
    state.tasks = mapped.concat(rest);
    state.sortMode = 'custom';
    save(); render();
  }

  /* ---------- export ---------- */
  function exportClipboard() {
    var today = todayStr();
    var undone = state.tasks.filter(function (t) { return !t.done; });
    var done = state.tasks.filter(function (t) { return t.done; });
    var lines = ['# 今日待办 ' + today, ''];
    lines.push('## 未完成 (' + undone.length + ')');
    sortUndone(undone).forEach(function (t) {
      var tags = [];
      tags.push(PRIO_NAME[t.priority]);
      if (t.project) tags.push(t.project);
      if (t.nature) tags.push(t.nature);
      if (t.due) tags.push('截止' + t.due);
      var late = dayDiff(t.due, today);
      lines.push('- [ ] ' + t.title + '  [' + tags.join(' / ') + ']' + (late > 0 ? ' [逾期' + late + '天]' : ''));
    });
    lines.push('', '## 已完成 (' + done.length + ')');
    done.forEach(function (t) { lines.push('- [x] ' + t.title); });
    copyText(lines.join('\n')).then(function () { toast('已复制 ' + undone.length + ' 项待办到剪贴板'); });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------- theme ---------- */

  /* ---------- settings modal ---------- */
  function openSettings() {
    el.cfgBase.value = state.settings.base;
    el.cfgKey.value = state.settings.key;
    el.cfgModel.value = state.settings.model;
    el.settingsMask.classList.add('show');
  }
  function closeSettings() { el.settingsMask.classList.remove('show'); }
  function saveSettings() {
    state.settings.base = el.cfgBase.value.trim() || 'https://api.deepseek.com/v1';
    state.settings.key = el.cfgKey.value.trim();
    state.settings.model = el.cfgModel.value.trim() || 'deepseek-chat';
    save(); closeSettings(); toast('设置已保存');
  }

  /* ---------- init ---------- */
  function init() {
    bindList(el.openList);
    bindList(el.doneList);
    bindList(el.calDayList);

    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInput(); }
    });
    el.input.addEventListener('input', autoGrow);

    el.tabList.addEventListener('click', function () { setView('list'); });
    el.tabCal.addEventListener('click', function () { state.filter = 'all'; setView('cal'); });

    $('.stats').addEventListener('click', function (e) {
      var s = e.target.closest('.stat');
      if (!s) return;
      setFilter(s.getAttribute('data-filter'));
    });

    $('#calPrev').addEventListener('click', function () {
      state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    });
    $('#calNext').addEventListener('click', function () {
      state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    });
    $('#calToday').addEventListener('click', function () {
      var p = todayStr().split('-').map(Number);
      state.calYear = p[0]; state.calMonth = p[1] - 1; state.selectedDay = todayStr();
      renderCalendar();
    });
    el.calGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell || !cell.getAttribute('data-day')) return;
      selectDay(cell.getAttribute('data-day'));
    });

    $('#sortBtn').addEventListener('click', cycleSort);
    $('#aiBtn').addEventListener('click', aiSort);
    $('#exportBtn').addEventListener('click', exportClipboard);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#clearDoneBtn').addEventListener('click', clearDone);
    $('#settingsCancel').addEventListener('click', closeSettings);
    $('#settingsSave').addEventListener('click', saveSettings);

    $('#editCancel').addEventListener('click', closeEdit);
    $('#editSave').addEventListener('click', saveEdit);
    el.editPrio.addEventListener('click', function (e) {
      var b = e.target.closest('.pbtn');
      if (!b) return;
      state.editingPrio = parseInt(b.getAttribute('data-p'), 10);
      syncPrioButtons();
    });

    prioMenuEl.addEventListener('click', function (e) {
      var o = e.target.closest('.prio-opt');
      if (!o) return;
      setPriority(prioMenuFor, parseInt(o.getAttribute('data-p'), 10));
    });
    document.addEventListener('click', function (e) {
      if (!prioMenuEl.hidden && !e.target.closest('.prio') && !e.target.closest('#prioMenu')) closePrioMenu();
    });

    el.settingsMask.addEventListener('click', function (e) {
      if (e.target === el.settingsMask) closeSettings();
    });
    el.editMask.addEventListener('click', function (e) {
      if (e.target === el.editMask) closeEdit();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); el.input.focus(); }
      if (e.key === 'Escape') { closeSettings(); closeEdit(); closePrioMenu(); }
    });

    if (location.search.indexOf('view=cal') >= 0) state.view = 'cal';
    var monthParam = location.search.match(/[?&]month=(\d{4}-\d{2})/);
    if (monthParam) {
      var mp = monthParam[1].split('-').map(Number);
      state.calYear = mp[0]; state.calMonth = mp[1] - 1; state.view = 'cal';
    }

    applyTheme();
    setInterval(refresh, 5 * 60 * 1000); // 每 5 分钟自动刷新待办
    loadAndRender();
  }

  init();