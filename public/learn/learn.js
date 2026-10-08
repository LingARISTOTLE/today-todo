'use strict';

/* 今天学了吗 —— 每日学习日记 + 季度复盘 */

var state = {
  entries: [],            // [{ id, date, content, createdAt, updatedAt }]
  reviews: {},            // { "2026-Q4": "季度总结" }
  calYear: 0, calMonth: 0, // 月历（0-11）
  selectedDay: '',        // 日记 tab 选中的日期
  quarter: '',            // 复盘 tab 选中的季度
  tab: 'diary',
  editingId: null
};

/* ---------- 日期工具 ---------- */
function pad(n) { return (n < 10 ? '0' : '') + n; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function parseDay(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function dateToStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return dateToStr(d); }
function daysInclusive(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000) + 1; }

function currentQuarter() {
  var d = new Date();
  return d.getFullYear() + '-Q' + Math.ceil((d.getMonth() + 1) / 3);
}
function shiftQuarter(q, delta) {
  var m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) return currentQuarter();
  var idx = (+m[1]) * 4 + (+m[2] - 1) + delta;
  return Math.floor(idx / 4) + '-Q' + (idx % 4 + 1);
}
function quarterRange(q) {
  var m = /^(\d{4})-Q([1-4])$/.exec(q);
  var y = +m[1], qn = +m[2];
  var sm = (qn - 1) * 3 + 1;
  var em = sm + 2;
  return {
    start: y + '-' + pad(sm) + '-01',
    end: y + '-' + pad(em) + '-' + pad(new Date(y, em, 0).getDate())
  };
}

/* ---------- 派生数据 ---------- */
function learnedDays() {
  var set = {};
  state.entries.forEach(function (e) { if (e.date) set[e.date] = true; });
  return set;
}
function calcStreak() {
  var set = learnedDays();
  var d = todayStr();
  if (!set[d]) d = addDays(d, -1); // 今天还没写，不算断
  var n = 0;
  while (set[d]) { n++; d = addDays(d, -1); }
  return n;
}
function dayEntries(day) {
  return state.entries.filter(function (e) { return e.date === day; });
}

/* ---------- 渲染 ---------- */
function renderStreak() {
  $('#streakNum').textContent = calcStreak();
  $('#streakSub').textContent = learnedDays()[todayStr()] ? '今天已记录，继续保持！' : '今天还没记，写一条吧';
}

function renderCalendar() {
  var y = state.calYear, m = state.calMonth;
  $('#calTitle').textContent = y + '年' + (m + 1) + '月';
  var first = new Date(Date.UTC(y, m, 1));
  var startOffset = (first.getUTCDay() + 6) % 7; // 周一开头
  var daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  var cells = [];
  for (var i = 0; i < startOffset; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  var today = todayStr();
  var countByDay = {};
  state.entries.forEach(function (e) { if (e.date) countByDay[e.date] = (countByDay[e.date] || 0) + 1; });

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
    if (dayStr === state.selectedDay) cls.push('selected');
    var cnt = countByDay[dayStr] || 0;
    var badge = cnt
      ? '<span class="cal-badge" title="已学 ' + cnt + ' 条"><i class="cb-done">' + cnt + '</i></span>'
      : '';
    var sub = isWeekend ? '<span class="cal-sub">休</span>' : '';
    html += '<div class="' + cls.join(' ') + '" data-day="' + dayStr + '">' +
      '<span class="cal-num">' + dn + '</span>' + sub + badge + '</div>';
  });
  html += '</div>';
  $('#calGrid').innerHTML = html;
}

function entryHtml(e) {
  if (state.editingId === e.id) {
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

function renderDay() {
  var day = state.selectedDay;
  $('#dayHead').textContent = day + ' · 共 ' + dayEntries(day).length + ' 条';
  var list = dayEntries(day);
  $('#dayEntries').innerHTML = list.length
    ? list.map(entryHtml).join('')
    : '<div class="empty-hint">这一天还没有记录</div>';
}

function renderReview() {
  var q = state.quarter;
  $('#qTitle').textContent = q;
  var range = quarterRange(q);
  var today = todayStr();
  var effEnd = today < range.end ? today : range.end;

  var elapsed = today >= range.start ? daysInclusive(range.start, effEnd) : 0;
  var set = learnedDays();
  var written = 0;
  Object.keys(set).forEach(function (d) { if (d >= range.start && d <= effEnd) written++; });
  var missed = Math.max(0, elapsed - written);

  $('#reviewStats').innerHTML =
    '<div class="stat"><div class="n">' + written + '</div><div class="l">已学习天数</div></div>' +
    '<div class="stat"><div class="n">' + elapsed + '</div><div class="l">已过天数</div></div>' +
    '<div class="stat warn"><div class="n">' + missed + '</div><div class="l">未学习天数</div></div>';

  var reviewEl = $('#reviewInput');
  if (document.activeElement !== reviewEl) reviewEl.value = state.reviews[q] || '';

  var groups = {};
  state.entries.forEach(function (e) {
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
  $('#reviewList').innerHTML = html;
}

function render() {
  renderStreak();
  if (state.tab === 'diary') { renderCalendar(); renderDay(); }
  else renderReview();
}

/* ---------- 动作 ---------- */
function saveData(cb) {
  fetch('/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: state.entries, reviews: state.reviews })
  }).then(function () { if (cb) cb(); })
    .catch(function () { toast('保存失败'); });
}

function addEntry(content) {
  content = (content || '').trim();
  if (!content) { toast('写点内容再保存'); return; }
  var today = todayStr();
  state.entries.unshift({ id: uid(), date: today, content: content, createdAt: new Date().toISOString(), updatedAt: null });
  state.selectedDay = today;
  var d = new Date(); state.calYear = d.getFullYear(); state.calMonth = d.getMonth();
  saveData(function () { render(); });
}

function startEdit(id) { state.editingId = id; renderDay(); }
function cancelEdit() { state.editingId = null; renderDay(); }
function saveEdit(id, content) {
  content = (content || '').trim();
  if (!content) { toast('内容不能为空'); return; }
  var e = state.entries.find(function (x) { return x.id === id; });
  if (e) { e.content = content; e.updatedAt = new Date().toISOString(); }
  state.editingId = null;
  saveData(function () { render(); });
}
function delEntry(id) {
  if (!confirm('删除这条记录？')) return;
  state.entries = state.entries.filter(function (x) { return x.id !== id; });
  saveData(function () { render(); });
}
function saveReview() {
  var v = $('#reviewInput').value.trim();
  if (v) state.reviews[state.quarter] = v;
  else delete state.reviews[state.quarter];
  saveData(function () { toast('季度总结已保存'); });
}

function setTab(tab) {
  state.tab = tab;
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  $('#tab-diary').hidden = tab !== 'diary';
  $('#tab-review').hidden = tab !== 'review';
}
function shiftMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  else if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  render();
}

/* ---------- toast ---------- */
var toastTimer = null;
function toast(msg) {
  var el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

/* ---------- 加载 + 事件 ---------- */
function loadData() {
  fetch('/api/learn').then(function (r) { return r.json(); }).then(function (d) {
    state.entries = Array.isArray(d.entries) ? d.entries : [];
    state.reviews = (d && d.reviews) || {};
    render();
  }).catch(function () { render(); });
}

function init() {
  var d = new Date();
  state.calYear = d.getFullYear();
  state.calMonth = d.getMonth();
  state.selectedDay = todayStr();
  state.quarter = currentQuarter();

  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#quickSave').addEventListener('click', function () {
    addEntry($('#quickInput').value);
    $('#quickInput').value = '';
  });
  $('#quickInput').addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      addEntry($('#quickInput').value);
      $('#quickInput').value = '';
    }
  });

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    setTab(b.getAttribute('data-tab'));
    render();
  });

  $('#calPrev').addEventListener('click', function () { shiftMonth(-1); });
  $('#calNext').addEventListener('click', function () { shiftMonth(1); });
  $('#calToday').addEventListener('click', function () {
    var d = new Date(); state.calYear = d.getFullYear(); state.calMonth = d.getMonth();
    state.selectedDay = todayStr(); render();
  });
  $('#calGrid').addEventListener('click', function (e) {
    var cell = e.target.closest('.cal-cell');
    if (!cell || !cell.getAttribute('data-day')) return;
    state.selectedDay = cell.getAttribute('data-day');
    render();
  });

  $('#dayEntries').addEventListener('click', function (e) {
    var entry = e.target.closest('.entry');
    if (!entry) return;
    var id = entry.getAttribute('data-id');
    var act = e.target.getAttribute('data-act');
    if (act === 'edit') startEdit(id);
    else if (act === 'del') delEntry(id);
    else if (act === 'save') saveEdit(id, entry.querySelector('.e-edit').value);
    else if (act === 'cancel') cancelEdit();
  });

  $('#qPrev').addEventListener('click', function () { state.quarter = shiftQuarter(state.quarter, -1); render(); });
  $('#qNext').addEventListener('click', function () { state.quarter = shiftQuarter(state.quarter, 1); render(); });
  $('#reviewSave').addEventListener('click', saveReview);

  applyTheme();
  loadData();
}

init();
