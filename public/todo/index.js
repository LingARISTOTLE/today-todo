  'use strict';

import { warmHolidays } from '../shared/holidays.js';
import { todayStr, pad, niceDate, dayDiff, shiftDay, weekdayOf, fmtDue, fmtDateCN } from '../shared/utils.js';
import { createCalendar } from './calendar.js';

  var STORE_KEY = 'today-todo-v1';
  var PRIO = { 0: 'p0', 1: 'p1', 2: 'p2', 3: 'p3' };
  var PRIO_NAME = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3' };
  var PRIO_FULL = { 0: '紧急', 1: '高', 2: '中', 3: '低' };

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

  // 「今天学了吗」数据（独立于待办 state，走 /api/learn）
  var learnState = { entries: [], reviews: {} };
  // 学习视图状态
  var lrn = { calYear: 0, calMonth: 0, selectedDay: '', quarter: '', tab: 'diary', editingId: null };

  var el = {
    input: $('#input'), dateLabel: $('#dateLabel'), syncLabel: $('#syncLabel'),
    openList: $('#openList'), doneList: $('#doneList'),
    openLabel: $('#openLabel'), doneLabel: $('#doneLabel'),
    statOpenN: $('#statOpenN'), statTodayN: $('#statTodayN'),
    statLateN: $('#statLateN'), statDoneN: $('#statDoneN'),
    progressBar: $('#progressBar'), toast: $('#toast'),
    viewList: $('#viewList'), viewCal: $('#viewCal'), viewLearn: $('#viewLearn'),
    tabList: $('#tabList'), tabCal: $('#tabCal'), tabLearn: $('#tabLearn'),
    calTitle: $('#calTitle'), calGrid: $('#calGrid'),
    calDayHead: $('#calDayHead'), calDayList: $('#calDayList'),
    editMask: $('#editMask'),
    editTitle: $('#editTitle'), editProject: $('#editProject'), editProjectBtn: $('#editProjectBtn'),
    editDue: $('#editDue'),
    editPrio: $('#editPrio'), editNature: $('#editNature'), editNatureBtn: $('#editNatureBtn'),
    editGoalBtn: $('#editGoalBtn'), editGoalText: $('#editGoalText'),
    settingsMask: $('#settingsMask'),
    cfgBase: $('#cfgBase'), cfgKey: $('#cfgKey'), cfgModel: $('#cfgModel'),
    learnMeta: $('#learnMeta'), learnInput: $('#learnInput'), learnSave: $('#learnSave')
  };

  // 日历视图（拆到 calendar.js）
  var calendar = createCalendar({ state: state, el: el, sortUndone: sortUndone, taskHtml: taskHtml });

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
    state.dataVersion = (typeof d.dataVersion === 'number') ? d.dataVersion : 0;
    if (d.settings) {
      Object.assign(state.settings, d.settings);
      if (!Array.isArray(state.settings.projects)) state.settings.projects = ['架构师Agent', 'MAF数据迁移', '稽查虾'];
      if (!Array.isArray(state.settings.natures)) state.settings.natures = ['探索类', '交付类', '学习类'];
    }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var snap = JSON.parse(raw);
      // 兜底只接受「确实有任务」的快照，防止用旧空快照把实时数据清空
      if (Array.isArray(snap.tasks) && snap.tasks.length > 0) applyState(snap);
    } catch (e) { /* 忽略，保持默认空态 */ }
  }
  function persistLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  var deletedIds = []; // 本页删除过的任务 id，随保存提交给服务器做合并，防止旧页面覆盖 CLI 新增任务
  function save() {
    persistLocal();
    try {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, state, { deletedIds: deletedIds, dataVersion: state.dataVersion }))
      }).then(function (r) {
        if (r.status === 409) {
          // 页面数据是旧版本：拉取最新并提示，拒绝覆盖新版本
          refresh();
          toast('数据已在别处更新，已刷新，请重试刚才的操作');
          return;
        }
        if (r.ok) {
          deletedIds = [];
          r.json().then(function (j) {
            if (j && typeof j.dataVersion === 'number') state.dataVersion = j.dataVersion;
          }).catch(function () {});
        }
      }).catch(function () {});
    } catch (e) {}
  }
  function loadAndRender() {
    fetch('/api/state?_t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-server'); return r.json(); })
      .then(function (d) { applyState(d); persistLocal(); })
      .catch(function () { loadLocal(); })
      .then(function () { calendar.initCalendar(); setView(state.view); warmHolidays(state.calYear); updateSync(); el.input.focus(); });
  }
  function refresh() {
    fetch('/api/state?_t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no-server'); return r.json(); })
      .then(function (d) {
        applyState(d);
        persistLocal();
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

  /* ---------- 今天学了吗（首页卡片） ---------- */
  function loadLearn() {
    fetch('/api/learn?_t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
      .then(function (d) {
        learnState.entries = Array.isArray(d.entries) ? d.entries : [];
        learnState.reviews = (d && d.reviews) || {};
        if (!lrn.quarter) lrn.quarter = lrnCurrentQuarter();
        if (!lrn.calYear) { var n = new Date(); lrn.calYear = n.getFullYear(); lrn.calMonth = n.getMonth(); lrn.selectedDay = todayStr(); }
        renderLearnMeta();
        lrnRender();
      })
      .catch(function () {});
  }
  function renderLearnMeta() {
    var set = {};
    learnState.entries.forEach(function (e) { if (e.date) set[e.date] = true; });
    var today = todayStr();
    var todayCount = learnState.entries.filter(function (e) { return e.date === today; }).length;
    var d = today;
    if (!set[d]) d = shiftDay(d, -1); // 今天还没写，不算断
    var streak = 0;
    while (set[d]) { streak++; d = shiftDay(d, -1); }
    el.learnMeta.textContent = '连续 ' + streak + ' 天 · 今天已记 ' + todayCount + ' 条';
  }
  function addLearnEntry() {
    var content = el.learnInput.value.trim();
    if (!content) { toast('写点内容再记录'); return; }
    // 先拉最新，避免覆盖其它标签页的修改
    fetch('/api/learn?_t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
      .then(function (d) {
        var entries = Array.isArray(d.entries) ? d.entries : [];
        var reviews = (d && d.reviews) || {};
        entries.unshift({ id: uid(), date: todayStr(), content: content, createdAt: new Date().toISOString(), updatedAt: null });
        return fetch('/api/learn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: entries, reviews: reviews })
        });
      })
      .then(function () {
        el.learnInput.value = '';
        return loadLearn();
      })
      .then(function () { toast('已记下今天的学习'); })
      .catch(function () { toast('记录失败'); });
  }

  /* ---------- 学习视图（合并自 /learn） ---------- */
  function lrnDays() {
    var set = {};
    learnState.entries.forEach(function (e) { if (e.date) set[e.date] = true; });
    return set;
  }
  function lrnStreak() {
    var set = lrnDays();
    var d = todayStr();
    if (!set[d]) d = shiftDay(d, -1); // 今天还没写，不算断
    var n = 0;
    while (set[d]) { n++; d = shiftDay(d, -1); }
    return n;
  }
  function lrnDayEntries(day) {
    return learnState.entries.filter(function (e) { return e.date === day; });
  }
  function lrnParseDay(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function lrnDaysInclusive(a, b) { return Math.round((lrnParseDay(b) - lrnParseDay(a)) / 86400000) + 1; }
  function lrnCurrentQuarter() {
    var d = new Date();
    return d.getFullYear() + '-Q' + Math.ceil((d.getMonth() + 1) / 3);
  }
  function lrnShiftQuarter(q, delta) {
    var m = /^(\d{4})-Q([1-4])$/.exec(q);
    if (!m) return lrnCurrentQuarter();
    var idx = (+m[1]) * 4 + (+m[2] - 1) + delta;
    return Math.floor(idx / 4) + '-Q' + (idx % 4 + 1);
  }
  function lrnQuarterRange(q) {
    var m = /^(\d{4})-Q([1-4])$/.exec(q);
    var y = +m[1], qn = +m[2];
    var sm = (qn - 1) * 3 + 1, em = sm + 2;
    return { start: y + '-' + pad(sm) + '-01', end: y + '-' + pad(em) + '-' + pad(new Date(y, em, 0).getDate()) };
  }

  function lrnRenderCalendar() {
    var y = lrn.calYear, m = lrn.calMonth;
    $('#lrnCalTitle').textContent = y + '年' + (m + 1) + '月';
    var first = new Date(Date.UTC(y, m, 1));
    var startOffset = (first.getUTCDay() + 6) % 7; // 周一开头
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var cells = [];
    for (var i = 0; i < startOffset; i++) cells.push(null);
    for (var d = 1; d <= dim; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    var today = todayStr();
    var countByDay = {};
    learnState.entries.forEach(function (e) { if (e.date) countByDay[e.date] = (countByDay[e.date] || 0) + 1; });

    var html = '<div class="cal-weekday">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    html += '<div class="cal-days">';
    cells.forEach(function (dn) {
      if (dn === null) { html += '<div class="cal-cell blank"></div>'; return; }
      var dayStr = y + '-' + pad(m + 1) + '-' + pad(dn);
      var wd = new Date(Date.UTC(y, m, dn)).getUTCDay();
      var isWeekend = (wd === 0 || wd === 6);
      var cls = ['cal-cell'];
      if (isWeekend) cls.push('weekend');
      if (dayStr === today) cls.push('today');
      if (dayStr === lrn.selectedDay) cls.push('selected');
      var cnt = countByDay[dayStr] || 0;
      var badge = cnt ? '<span class="cal-badge" title="已学 ' + cnt + ' 条"><i class="cb-done">' + cnt + '</i></span>' : '';
      var sub = isWeekend ? '<span class="cal-sub">休</span>' : '';
      html += '<div class="' + cls.join(' ') + '" data-day="' + dayStr + '">' +
        '<span class="cal-num">' + dn + '</span>' + sub + badge + '</div>';
    });
    html += '</div>';
    $('#lrnCalGrid').innerHTML = html;
  }

  function lrnEntryHtml(e) {
    if (lrn.editingId === e.id) {
      return '<div class="entry editing" data-id="' + esc(e.id) + '">' +
        '<textarea class="e-edit">' + esc(e.content) + '</textarea>' +
        '<div class="e-acts"><button data-act="save">保存</button><button data-act="cancel">取消</button></div></div>';
    }
    var meta = '';
    if (e.createdAt) meta += '记于 ' + (e.createdAt.slice(11, 16) || '');
    if (e.updatedAt) meta += ' · 改于 ' + e.updatedAt.slice(11, 16);
    return '<div class="entry" data-id="' + esc(e.id) + '">' +
      (meta ? '<div class="e-meta">' + esc(meta) + '</div>' : '') +
      '<div class="e-content">' + esc(e.content) + '</div>' +
      '<div class="e-acts"><button data-act="edit">编辑</button><button data-act="del" class="del">删除</button></div></div>';
  }

  function lrnRenderDay() {
    var day = lrn.selectedDay;
    var list = lrnDayEntries(day);
    $('#lrnDayHead').textContent = day + ' · 共 ' + list.length + ' 条';
    $('#lrnDayEntries').innerHTML = list.length ? list.map(lrnEntryHtml).join('') : '<div class="empty-hint">这一天还没有记录</div>';
  }

  function lrnRenderReview() {
    var q = lrn.quarter;
    $('#lrnQTitle').textContent = q;
    var range = lrnQuarterRange(q);
    var today = todayStr();
    var effEnd = today < range.end ? today : range.end;
    var elapsed = today >= range.start ? lrnDaysInclusive(range.start, effEnd) : 0;
    var set = lrnDays();
    var written = 0;
    Object.keys(set).forEach(function (d) { if (d >= range.start && d <= effEnd) written++; });
    var missed = Math.max(0, elapsed - written);
    $('#lrnReviewStats').innerHTML =
      '<div class="stat"><div class="n">' + written + '</div><div class="l">已学习天数</div></div>' +
      '<div class="stat"><div class="n">' + elapsed + '</div><div class="l">已过天数</div></div>' +
      '<div class="stat warn"><div class="n">' + missed + '</div><div class="l">未学习天数</div></div>';
    var reviewEl = $('#lrnReviewInput');
    if (document.activeElement !== reviewEl) reviewEl.value = learnState.reviews[q] || '';
    var groups = {};
    learnState.entries.forEach(function (e) {
      if (e.date >= range.start && e.date <= range.end) {
        groups[e.date] = groups[e.date] || [];
        groups[e.date].push(e);
      }
    });
    var dates = Object.keys(groups).sort().reverse();
    var html = '';
    if (!dates.length) {
      html = '<div class="empty-hint">这个季度还没有记录</div>';
    } else {
      dates.forEach(function (d) {
        html += '<div class="review-day">' + d + '</div>';
        groups[d].forEach(function (e) {
          html += '<div class="entry"><div class="e-content">' + esc(e.content) + '</div></div>';
        });
      });
    }
    $('#lrnReviewList').innerHTML = html;
  }

  function lrnRender() {
    $('#lrnStreakNum').textContent = lrnStreak();
    $('#lrnStreakSub').textContent = lrnDays()[todayStr()] ? '今天已记录，继续保持！' : '今天还没记，写一条吧';
    $('#lrnTabDiary').hidden = lrn.tab !== 'diary';
    $('#lrnTabReview').hidden = lrn.tab !== 'review';
    Array.prototype.forEach.call($('#lrnTabs').querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === lrn.tab);
    });
    if (lrn.tab === 'diary') { lrnRenderCalendar(); lrnRenderDay(); }
    else lrnRenderReview();
  }

  function lrnSaveData(cb) {
    fetch('/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: learnState.entries, reviews: learnState.reviews })
    }).then(function () { if (cb) cb(); }).catch(function () { toast('保存失败'); });
  }

  function lrnAddEntry(content) {
    content = (content || '').trim();
    if (!content) { toast('写点内容再记录'); return; }
    learnState.entries.unshift({ id: uid(), date: todayStr(), content: content, createdAt: new Date().toISOString(), updatedAt: null });
    lrn.selectedDay = todayStr();
    lrnSaveData(function () { lrnRender(); renderLearnMeta(); toast('已记下今天的学习'); });
  }

  function lrnSetTab(t) {
    lrn.tab = t === 'review' ? 'review' : 'diary';
    if (lrn.tab === 'review' && !lrn.quarter) lrn.quarter = lrnCurrentQuarter();
    lrnRender();
  }

  function lrnShiftMonth(delta) {
    lrn.calMonth += delta;
    if (lrn.calMonth < 0) { lrn.calMonth = 11; lrn.calYear--; }
    else if (lrn.calMonth > 11) { lrn.calMonth = 0; lrn.calYear++; }
    lrnRender();
  }

  function lrnStartEdit(id) {
    lrn.editingId = id;
    lrnRenderDay();
    var ta = document.querySelector('#lrnDayEntries textarea.e-edit');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  function lrnCancelEdit() { lrn.editingId = null; lrnRenderDay(); }
  function lrnSaveEdit(id, val) {
    val = (val || '').trim();
    var e = learnState.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    if (!val) { lrnDelEntry(id); return; }
    e.content = val; e.updatedAt = new Date().toISOString();
    lrn.editingId = null;
    lrnSaveData(function () { lrnRender(); renderLearnMeta(); });
  }
  function lrnDelEntry(id) {
    learnState.entries = learnState.entries.filter(function (x) { return x.id !== id; });
    lrn.editingId = null;
    lrnSaveData(function () { lrnRender(); renderLearnMeta(); });
  }
  function lrnSaveReview() {
    var v = $('#lrnReviewInput').value.trim();
    if (!v) { toast('写点内容再保存'); return; }
    learnState.reviews[lrn.quarter] = v;
    lrnSaveData(function () { lrnRenderReview(); toast('季度总结已保存'); });
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
  var editingGoalId = '';
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
    deletedIds.push(id);
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
    state.tasks.filter(function (x) { return x.done; }).forEach(function (t) { deletedIds.push(t.id); });
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
    if (state.view === 'cal') calendar.renderCalendar();
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

  /* ---------- tag editor modal ---------- */
  function goalTitle(id) {
    if (!id) return '（不关联）';
    var g = state.goals.find(function (x) { return x.id === id; });
    return g ? g.title : '（不关联）';
  }
  function syncGoalSelect() {
    el.editGoalText.textContent = goalTitle(editingGoalId);
  }
  function openEdit(id) {
    var t = state.tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    state.editingId = id;
    state.editingPrio = t.priority;
    el.editTitle.value = t.title;
    el.editProject.value = t.project || '';
    el.editDue.value = t.due || '';
    el.editNature.value = t.nature || '';
    editingGoalId = t.goalId || '';
    syncGoalSelect();
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
    t.goalId = editingGoalId || '';
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
    el.tabLearn.classList.toggle('active', v === 'learn');
    el.viewList.style.display = v === 'list' ? '' : 'none';
    el.viewCal.style.display = v === 'cal' ? '' : 'none';
    el.viewLearn.style.display = v === 'learn' ? '' : 'none';
    if (v === 'learn') loadLearn();
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
    el.tabLearn.addEventListener('click', function () { setView('learn'); });

    $('.stats').addEventListener('click', function (e) {
      var s = e.target.closest('.stat');
      if (!s) return;
      setFilter(s.getAttribute('data-filter'));
    });

    $('#calPrev').addEventListener('click', function () {
      state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      calendar.renderCalendar();
    });
    $('#calNext').addEventListener('click', function () {
      state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      calendar.renderCalendar();
    });
    $('#calToday').addEventListener('click', function () {
      var p = todayStr().split('-').map(Number);
      state.calYear = p[0]; state.calMonth = p[1] - 1; state.selectedDay = todayStr();
      calendar.renderCalendar();
    });
    el.calGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell || !cell.getAttribute('data-day')) return;
      calendar.selectDay(cell.getAttribute('data-day'));
    });

    $('#sortBtn').addEventListener('click', cycleSort);
    $('#aiBtn').addEventListener('click', aiSort);
    $('#exportBtn').addEventListener('click', exportClipboard);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#clearDoneBtn').addEventListener('click', clearDone);

    el.learnSave.addEventListener('click', addLearnEntry);
    el.learnInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addLearnEntry(); }
    });

    // 学习视图入口
    $('#learnNavBtn').addEventListener('click', function () { setView('learn'); });
    $('#learnGo').addEventListener('click', function (e) { e.preventDefault(); setView('learn'); });

    // 学习视图交互
    $('#lrnQuickSave').addEventListener('click', function () {
      lrnAddEntry($('#lrnQuickInput').value);
      $('#lrnQuickInput').value = '';
    });
    $('#lrnQuickInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#lrnQuickSave').click(); }
    });
    $('#lrnTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      lrnSetTab(b.getAttribute('data-tab'));
    });
    $('#lrnCalPrev').addEventListener('click', function () { lrnShiftMonth(-1); });
    $('#lrnCalNext').addEventListener('click', function () { lrnShiftMonth(1); });
    $('#lrnCalToday').addEventListener('click', function () {
      var d = new Date(); lrn.calYear = d.getFullYear(); lrn.calMonth = d.getMonth();
      lrn.selectedDay = todayStr(); lrnRender();
    });
    $('#lrnCalGrid').addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell || !cell.getAttribute('data-day')) return;
      lrn.selectedDay = cell.getAttribute('data-day');
      lrnRender();
    });
    $('#lrnDayEntries').addEventListener('click', function (e) {
      var entry = e.target.closest('.entry');
      if (!entry) return;
      var id = entry.getAttribute('data-id');
      var act = e.target.getAttribute('data-act');
      if (act === 'edit') lrnStartEdit(id);
      else if (act === 'del') lrnDelEntry(id);
      else if (act === 'save') lrnSaveEdit(id, entry.querySelector('.e-edit').value);
      else if (act === 'cancel') lrnCancelEdit();
    });
    $('#lrnQPrev').addEventListener('click', function () { lrn.quarter = lrnShiftQuarter(lrn.quarter, -1); lrnRender(); });
    $('#lrnQNext').addEventListener('click', function () { lrn.quarter = lrnShiftQuarter(lrn.quarter, 1); lrnRender(); });
    $('#lrnReviewSave').addEventListener('click', lrnSaveReview);

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
    window.dropdown(el.editProjectBtn, $('#projectMenu'), function () {
      return state.settings.projects.map(function (p) {
        return { value: p, label: p, active: el.editProject.value === p };
      });
    }, function (v) { el.editProject.value = v; });

    window.dropdown(el.editNatureBtn, $('#natureMenu'), function () {
      return state.settings.natures.map(function (n) {
        return { value: n, label: n, active: el.editNature.value === n };
      });
    }, function (v) { el.editNature.value = v; });

    window.dropdown(el.editGoalBtn, $('#goalMenu'), function () {
      var items = [{ value: '', label: '（不关联）', muted: true, active: !editingGoalId }];
      state.goals.forEach(function (g) {
        items.push({ value: g.id, label: g.title, sub: (g.dimension || '') + ' · ' + (g.quarter || ''), active: editingGoalId === g.id });
      });
      return items;
    }, function (v) { editingGoalId = v; syncGoalSelect(); });

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
    setInterval(function () { refresh(); loadLearn(); }, 5 * 60 * 1000); // 每 5 分钟自动刷新
    // 从 bfcache 恢复 / 切回标签页时重新拉数据，避免页面内导航返回后显示空白
    window.addEventListener('pageshow', function (e) { if (e.persisted) { refresh(); loadLearn(); } });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { refresh(); loadLearn(); } });
    loadAndRender();
    loadLearn();
  }

  init();