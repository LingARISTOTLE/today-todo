'use strict';

/* 日历视图：独立成模块，通过工厂注入应用级依赖（state / el / sortUndone / taskHtml） */

import { holidayCache, fetchHolidays } from './holidays.js';
import { todayStr, pad, shiftDay, weekdayOf, fmtDateCN } from './utils.js';

export function createCalendar(deps) {
  var state = deps.state, el = deps.el;
  var sortUndone = deps.sortUndone, taskHtml = deps.taskHtml;

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

  return { initCalendar: initCalendar, renderCalendar: renderCalendar, selectDay: selectDay };
}
