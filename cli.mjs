#!/usr/bin/env node
// today-todo CLI —— 零依赖，操作项目根目录的 data.json（与网页共用同一份数据）
// 用法见 `node cli.mjs help`
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data.json');
const PRIO = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3' };

function defaultState() {
  return {
    tasks: [],
    settings: {
      base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat',
      projects: ['架构师Agent', 'MAF数据迁移', '稽查虾'],
      natures: ['探索类', '交付类', '学习类']
    }
  };
}
function parseData(raw) {
  const d = JSON.parse(raw);
  if (!d || typeof d !== 'object') throw new Error('bad data');
  d.tasks = (Array.isArray(d.tasks) ? d.tasks : []).map((t) => {
    if (!t.due) t.due = t.createdDay || todayStr(); // 截止日期必填：缺失回填
    return t;
  });
  return d;
}
function load() {
  if (!existsSync(DATA_FILE)) return defaultState();
  try {
    return parseData(readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('[today-todo] data.json 解析失败，尝试从 .bak 恢复:', e.message);
    const bak = DATA_FILE + '.bak';
    if (existsSync(bak)) {
      try { return parseData(readFileSync(bak, 'utf8')); }
      catch (e2) { console.error('[today-todo] .bak 也损坏:', e2.message); }
    }
    return defaultState();
  }
}
function save(data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  if (existsSync(DATA_FILE)) {
    try { copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) { console.error('备份失败:', e.message); }
  }
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, DATA_FILE);
}
function archiveFile(month) {
  return join(__dirname, 'data-' + month + '.json');
}
function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dayDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function sortedUndone(data) {
  return data.tasks.filter((t) => !t.done).slice()
    .sort((a, b) => (a.priority - b.priority) || (a.createdAt < b.createdAt ? -1 : 1));
}
function resolveTarget(data, arg) {
  if (!arg) return null;
  const byId = data.tasks.find((t) => t.id === arg);
  if (byId) return byId;
  const n = parseInt(arg, 10);
  const undone = sortedUndone(data);
  if (!isNaN(n) && n >= 1 && n <= undone.length) return undone[n - 1];
  return null;
}
function parseFlags(args) {
  const flags = {}, rest = [];
  args.forEach((a) => {
    let body = a, isFlag = false;
    if (typeof a === 'string' && a.indexOf('--') === 0) { body = a.slice(2); isFlag = true; }
    else if (typeof a === 'string' && !a.startsWith('-') && a.indexOf('=') > 0) { isFlag = true; } // 支持 key=value
    if (isFlag) {
      const eq = body.indexOf('=');
      if (eq > 0) flags[body.slice(0, eq)] = body.slice(eq + 1);
      else flags[body] = true;
    } else rest.push(a);
  });
  return { flags, rest };
}
function parsePrio(s) {
  if (s == null) return null;
  const n = parseInt(String(s).trim().toUpperCase().replace(/^P/, ''), 10);
  return (isNaN(n) || n < 0 || n > 3) ? null : n;
}
function fmtTags(t) {
  const parts = ['<' + PRIO[t.priority] + '>'];
  if (t.project) parts.push('[' + t.project + ']');
  if (t.nature) parts.push('(' + t.nature + ')');
  if (t.due) parts.push('截止 ' + t.due);
  return parts.join(' ');
}

function formatList(data) {
  const today = todayStr();
  const undone = sortedUndone(data);
  const done = data.tasks.filter((t) => t.done);
  const lines = [];
  lines.push('今日待办  ' + today);
  lines.push('─'.repeat(52));
  lines.push('未完成 (' + undone.length + ')');
  undone.forEach((t, i) => {
    const late = dayDiff(t.due, today);
    const lateTxt = late > 0 ? ' · 逾期 ' + late + ' 天' : '';
    lines.push(`  [${i + 1}] ${fmtTags(t)} ${t.title}${lateTxt}`);
  });
  if (done.length) {
    lines.push('已完成 (' + done.length + ')');
    done.forEach((t) => lines.push(`  [x] ${t.title}`));
  }
  if (!undone.length && !done.length) lines.push('  （还没有任何任务，用 node cli.mjs add "..." 加一条）');
  lines.push('─'.repeat(52));
  return lines.join('\n');
}

const HELP = `today-todo CLI

用法：node cli.mjs <命令> [参数]

命令：
  add "标题" ["标题2" ...]     添加一条或多条（默认 P2，截止=今天）
     可带标签：--project=XX --nature=YY --due=YYYY-MM-DD --prio=P0|P1|P2|P3
     （无标题参数时从 stdin 按行读取批量添加）
  list                         列出所有待办（默认命令）
  done <编号|id>               标记完成
  undo <编号|id>               恢复为未完成
  rm  <编号|id>                删除
  prio <编号|id> <P0..P3|0..3> 设优先级（P0 最高）
  project <编号|id> <名称|none> 设项目标签
  nature  <编号|id> <名称|none> 设性质标签
  due     <编号|id> [日期]     设截止日期（YYYY-MM-DD，缺省=今天）
  tag <编号|id> [project=..] [nature=..] [due=..] [prio=..]  一次改多个标签
  sort [priority|due|created|late]  重排未完成任务（默认 priority）
  clear-done                   清除所有已完成
  archive [YYYY-MM]            归档已完成任务到 data-YYYY-MM.json（缺省归档所有已过月份；未完成任务不动）
  export                       输出 Markdown（含标签，可粘给 AI / 笔记）
  help                         本帮助

提示：编号用 list 里显示的 [n]（1 起始）；也可用完整任务 id。`;

const args = process.argv.slice(2);
const cmd = args[0] || 'list';
const data = load();
const print = (s) => console.log(s);

switch (cmd) {
  case 'add': {
    const parsed = parseFlags(args.slice(1));
    let titles = parsed.rest;
    if (titles.length === 0 && !process.stdin.isTTY) {
      titles = readFileSync(0, 'utf8').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    }
    if (titles.length === 0) { print('用法：node cli.mjs add "标题" [--project=..] [--due=..] [--nature=..] [--prio=P0..P3]'); break; }
    const prio = parsePrio(parsed.flags.prio);
    if ('prio' in parsed.flags && prio == null) { print('优先级需为 P0/P1/P2/P3（或 0-3）'); break; }
    const project = parsed.flags.project || '';
    const nature = parsed.flags.nature || '';
    const today = todayStr();
    const due = parsed.flags.due || today;
    let n = 0;
    for (const t of titles) {
      if (!t || !t.trim()) continue;
      data.tasks.unshift({
        id: randomUUID(), title: t.trim(),
        priority: (prio == null ? 2 : prio), project, nature, due,
        createdDay: today, createdAt: new Date().toISOString(), done: false, doneAt: null
      });
      n++;
    }
    save(data);
    print('已添加 ' + n + ' 项' + (project ? '（项目：' + project + '）' : ''));
    titles.filter(Boolean).forEach((t) => print('  + ' + t));
    break;
  }
  case 'list':
    print(formatList(data));
    break;
  case 'done':
  case 'undo': {
    const t = resolveTarget(data, args[1]);
    if (!t) { print('未找到该任务，先 node cli.mjs list 看编号或 id'); break; }
    t.done = (cmd === 'done');
    t.doneAt = t.done ? new Date().toISOString() : null;
    save(data);
    print((cmd === 'done' ? '已完成：' : '已恢复：') + t.title);
    break;
  }
  case 'rm': {
    const t = resolveTarget(data, args[1]);
    if (!t) { print('未找到该任务'); break; }
    data.tasks = data.tasks.filter((x) => x.id !== t.id);
    save(data);
    print('已删除：' + t.title);
    break;
  }
  case 'prio': {
    const t = resolveTarget(data, args[1]);
    const p = parsePrio(args[2]);
    if (!t) { print('未找到该任务'); break; }
    if (p == null) { print('优先级需为 P0/P1/P2/P3（或 0-3）'); break; }
    t.priority = p;
    save(data);
    print(`已设优先级 <${PRIO[p]}>：${t.title}`);
    break;
  }
  case 'project':
  case 'nature': {
    const t = resolveTarget(data, args[1]);
    if (!t) { print('未找到该任务'); break; }
    const v = args[2] === 'none' ? '' : (args[2] || '');
    t[cmd] = v;
    save(data);
    print(`已设${cmd === 'project' ? '项目' : '性质'}=${v || '(无)'}：${t.title}`);
    break;
  }
  case 'due': {
    const t = resolveTarget(data, args[1]);
    if (!t) { print('未找到该任务'); break; }
    const v = (args[2] && args[2] !== 'none') ? args[2] : todayStr();
    t.due = v;
    save(data);
    print(`已设截止=${v}：${t.title}`);
    break;
  }
  case 'tag': {
    const parsed = parseFlags(args.slice(1));
    const t = resolveTarget(data, parsed.rest[0]);
    if (!t) { print('未找到该任务'); break; }
    const changed = [];
    if ('project' in parsed.flags) { t.project = parsed.flags.project; changed.push('项目'); }
    if ('nature' in parsed.flags) { t.nature = parsed.flags.nature; changed.push('性质'); }
    if ('due' in parsed.flags) { t.due = (parsed.flags.due && parsed.flags.due !== 'none') ? parsed.flags.due : todayStr(); changed.push('截止'); }
    if ('prio' in parsed.flags) {
      const p = parsePrio(parsed.flags.prio);
      if (p == null) { print('优先级需为 P0/P1/P2/P3'); break; }
      t.priority = p; changed.push('优先级');
    }
    save(data);
    print('已更新 ' + (changed.join('/') || '无变化') + '：' + t.title);
    break;
  }
  case 'sort': {
    const mode = args[1] || 'priority';
    const undone = sortedUndone(data);
    let ordered;
    if (mode === 'created') ordered = undone.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    else if (mode === 'due') ordered = undone.slice().sort((a, b) => {
      if (!a.due && !b.due) return a.priority - b.priority;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : (a.due > b.due ? 1 : (a.priority - b.priority));
    });
    else if (mode === 'late') ordered = undone.slice().sort((a, b) => (dayDiff(b.due, todayStr()) - dayDiff(a.due, todayStr())) || (a.priority - b.priority));
    else ordered = undone.slice().sort((a, b) => a.priority - b.priority);
    data.tasks = ordered.concat(data.tasks.filter((t) => t.done));
    save(data);
    print('已按 ' + mode + ' 排序');
    break;
  }
  case 'clear-done': {
    const n = data.tasks.filter((t) => t.done).length;
    data.tasks = data.tasks.filter((t) => !t.done);
    save(data);
    print('已清除 ' + n + ' 项已完成');
    break;
  }
  case 'archive': {
    const arg = args[1]; // 可选 YYYY-MM
    if (arg && !/^\d{4}-\d{2}$/.test(arg)) { print('用法：node cli.mjs archive [YYYY-MM]（月份格式如 2026-09）'); break; }
    const today = todayStr();
    const curMonth = today.slice(0, 7);
    const moved = {};
    const keep = [];
    for (const t of data.tasks) {
      if (!t.done) { keep.push(t); continue; } // 只归档已完成的，未完成永远留在 data.json
      const m = (t.due || t.createdDay || '').slice(0, 7);
      const should = arg ? (m === arg) : (!!m && m < curMonth);
      if (should) { (moved[m] = moved[m] || []).push(t); }
      else keep.push(t);
    }
    data.tasks = keep;
    save(data);
    const months = Object.keys(moved).sort();
    let total = 0;
    for (const m of months) {
      const fp = archiveFile(m);
      let arch = [];
      if (existsSync(fp)) { try { arch = JSON.parse(readFileSync(fp, 'utf8')); } catch (e) { arch = []; } }
      if (!Array.isArray(arch)) arch = [];
      arch = arch.concat(moved[m]);
      writeFileSync(fp, JSON.stringify(arch, null, 2) + '\n', 'utf8');
      total += moved[m].length;
      print('归档 ' + moved[m].length + ' 项 → data-' + m + '.json');
    }
    print(total === 0 ? '没有需要归档的已完成任务（当月及未来的不会动）' : '共归档 ' + total + ' 项');
    break;
  }
  case 'export': {
    const today = todayStr();
    const undone = sortedUndone(data);
    const done = data.tasks.filter((t) => t.done);
    const L = [];
    L.push('# 今日待办 ' + today, '');
    L.push('## 未完成 (' + undone.length + ')');
    undone.forEach((t) => {
      const tags = [PRIO[t.priority]];
      if (t.project) tags.push(t.project);
      if (t.nature) tags.push(t.nature);
      if (t.due) tags.push('截止' + t.due);
      const late = dayDiff(t.due, today);
      L.push('- [ ] ' + t.title + '  [' + tags.join(' / ') + ']' + (late > 0 ? ' [逾期' + late + '天]' : ''));
    });
    L.push('', '## 已完成 (' + done.length + ')');
    done.forEach((t) => L.push('- [x] ' + t.title));
    print(L.join('\n'));
    break;
  }
  case 'help':
  default:
    print(HELP);
}
