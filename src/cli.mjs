#!/usr/bin/env node
// today-todo CLI —— 零依赖，操作项目根目录的 data.json（与网页共用同一份数据）
// 用法见 `node src/cli.mjs help`
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { load, save, todayStr, loadLearn, saveLearn } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRIO = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3' };

function archiveFile(month) {
  return join(__dirname, '..', 'data-' + month + '.json');
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
function currentQuarter() {
  const d = new Date();
  return d.getFullYear() + '-Q' + Math.ceil((d.getMonth() + 1) / 3);
}
const GOAL_STATUS = { todo: '未开始', doing: '进行中', done: '已完成' };
function visibleGoals(data, quarter) {
  return quarter === 'all' ? data.goals.slice() : data.goals.filter((g) => g.quarter === quarter);
}
function resolveGoal(data, arg, quarter) {
  if (!arg) return null;
  const byId = data.goals.find((g) => g.id === arg);
  if (byId) return byId;
  const list = visibleGoals(data, quarter);
  const n = parseInt(arg, 10);
  if (!isNaN(n) && n >= 1 && n <= list.length) return list[n - 1];
  const matches = data.goals.filter((g) => g.title && g.title.indexOf(arg) >= 0);
  return matches.length === 1 ? matches[0] : null;
}
function formatGoals(data, quarter) {
  const goals = visibleGoals(data, quarter);
  const lines = [];
  lines.push('中期目标  ' + (quarter === 'all' ? '（全部季度）' : quarter));
  lines.push('─'.repeat(52));
  if (!goals.length) lines.push('  （该季度暂无目标）');
  goals.forEach((g, i) => {
    const tags = [g.dimension, g.category, GOAL_STATUS[g.status] || g.status].filter(Boolean).join('/');
    lines.push(`  [${i + 1}] [${tags}] ${g.title}`);
    if (g.note) lines.push('        备注：' + g.note);
    if (g.docs && g.docs.length) lines.push('        笔记 ' + g.docs.length + ' 篇');
  });
  lines.push('─'.repeat(52));
  return lines.join('\n');
}
function formatLearn(learn) {
  const entries = learn.entries || [];
  const lines = [];
  lines.push('学习日记  共 ' + entries.length + ' 条');
  lines.push('─'.repeat(52));
  if (!entries.length) lines.push('  （还没有学习记录）');
  let lastDate = '';
  entries.forEach((e) => {
    if (e.date !== lastDate) { lastDate = e.date; lines.push('  ' + e.date); }
    lines.push('    - ' + e.content);
  });
  lines.push('─'.repeat(52));
  return lines.join('\n');
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
  if (!undone.length && !done.length) lines.push('  （还没有任何任务，用 node src/cli.mjs add "..." 加一条）');
  lines.push('─'.repeat(52));
  return lines.join('\n');
}

const HELP = `today-todo CLI

用法：node src/cli.mjs <命令> [参数]

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

目标（中期目标）：
  goal-list [YYYY-QN|all]      列出目标（缺省=当前季度；all=全部）
  goal-add "标题" [--quarter=YYYY-QN] [--dimension=内功|战功] [--category=XX] [--link=URL] [--note=XX] [--status=todo|doing|done]
  goal-status <id|编号|标题关键词> <todo|doing|done>   改目标状态
  goal-rm   <id|编号|标题关键词>                       删除目标

学习（今天学了吗）：
  learn-add "内容"             记一条今天的学习
  learn-list [YYYY-MM-DD|YYYY-MM]  列出学习日记（可按日期过滤）
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
    if (titles.length === 0) { print('用法：node src/cli.mjs add "标题" [--project=..] [--due=..] [--nature=..] [--prio=P0..P3]'); break; }
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
    if (!t) { print('未找到该任务，先 node src/cli.mjs list 看编号或 id'); break; }
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
    if (arg && !/^\d{4}-\d{2}$/.test(arg)) { print('用法：node src/cli.mjs archive [YYYY-MM]（月份格式如 2026-09）'); break; }
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
  case 'goal-list': {
    const q = args[1] || currentQuarter();
    if (q !== 'all' && !/^\d{4}-Q[1-4]$/.test(q)) { print('季度格式：YYYY-QN（如 2026-Q4），或 all'); break; }
    print(formatGoals(data, q));
    break;
  }
  case 'goal-add': {
    const parsed = parseFlags(args.slice(1));
    const title = (parsed.rest[0] || '').trim();
    if (!title) { print('用法：node src/cli.mjs goal-add "标题" [--quarter=..] [--dimension=内功|战功] [--category=..] [--link=..] [--note=..] [--status=todo|doing|done]'); break; }
    const dim = parsed.flags.dimension || '内功';
    const status = parsed.flags.status || 'todo';
    if (dim !== '内功' && dim !== '战功') { print('维度需为 内功 或 战功'); break; }
    if (!['todo', 'doing', 'done'].includes(status)) { print('状态需为 todo / doing / done'); break; }
    const quarter = parsed.flags.quarter || currentQuarter();
    data.goals.push({
      id: randomUUID(), quarter, dimension: dim, category: parsed.flags.category || '',
      title, link: parsed.flags.link || '', status, note: parsed.flags.note || '',
      createdAt: new Date().toISOString(), docs: []
    });
    save(data);
    print('已添加目标：' + title + '（' + dim + ' · ' + quarter + ' · ' + (GOAL_STATUS[status] || status) + '）');
    break;
  }
  case 'goal-status': {
    const g = resolveGoal(data, args[1], currentQuarter());
    if (!g) { print('未找到该目标，先 node src/cli.mjs goal-list 看编号/标题'); break; }
    const s = args[2];
    if (!['todo', 'doing', 'done'].includes(s)) { print('状态需为 todo / doing / done'); break; }
    g.status = s;
    save(data);
    print('已设状态 ' + (GOAL_STATUS[s] || s) + '：' + g.title);
    break;
  }
  case 'goal-rm': {
    const g = resolveGoal(data, args[1], currentQuarter());
    if (!g) { print('未找到该目标'); break; }
    data.goals = data.goals.filter((x) => x.id !== g.id);
    save(data);
    print('已删除目标：' + g.title);
    break;
  }
  case 'learn-add': {
    const content = args.slice(1).join(' ').trim();
    if (!content) { print('用法：node src/cli.mjs learn-add "今天学到的内容"'); break; }
    const learn = loadLearn();
    learn.entries.unshift({ id: randomUUID(), date: todayStr(), content, createdAt: new Date().toISOString(), updatedAt: null });
    saveLearn(learn);
    print('已记录：' + content);
    break;
  }
  case 'learn-list': {
    const learn = loadLearn();
    const arg = args[1];
    let entries = learn.entries || [];
    if (arg) entries = entries.filter((e) => e.date === arg || e.date.indexOf(arg) === 0);
    print(formatLearn({ entries }));
    break;
  }
  case 'help':
  default:
    print(HELP);
}
