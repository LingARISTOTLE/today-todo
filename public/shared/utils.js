'use strict';

/* 纯工具函数：日期 / 格式化（无状态，供各模块复用） */

var WDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function pad(n) { return (n < 10 ? '0' : '') + n; }
export function niceDate() {
  var d = new Date();
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + WDAY[d.getDay()];
}
export function dayDiff(fromStr, toStr) {
  var a = fromStr.split('-').map(Number), b = toStr.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}
export function shiftDay(dayStr, delta) {
  var p = dayStr.split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
}
export function weekdayOf(dayStr) {
  var p = dayStr.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}
export function fmtDue(dayStr) {
  var m = parseInt(dayStr.slice(5, 7), 10), d = parseInt(dayStr.slice(8, 10), 10);
  var y = dayStr.slice(0, 4);
  return (y === todayStr().slice(0, 4)) ? (m + '月' + d + '日') : (y + '年' + m + '月' + d + '日');
}
export function fmtDateCN(dayStr) {
  var m = parseInt(dayStr.slice(5, 7), 10), d = parseInt(dayStr.slice(8, 10), 10);
  return m + '月' + d + '日 · 周' + WDAY[weekdayOf(dayStr)];
}
