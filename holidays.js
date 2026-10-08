'use strict';

/* 中国法定节假日：优先从 holiday-cn 动态拉取，失败回退 2026 硬编码 */

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
export var holidayCache = { 2026: { holidays: HOLIDAYS, workdays: WORKDAYS } };
var holidayLoading = {};

export function fetchHolidays(year) {
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

export function warmHolidays(year) {
  fetchHolidays(year);
  fetchHolidays(year + 1);
}
