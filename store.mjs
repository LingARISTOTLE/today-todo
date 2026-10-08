// store.mjs —— 数据唯一读写入口（SQLite 后端，零外部依赖，用 Node 内置 node:sqlite）
// 对外接口不变：load()/save() 仍以完整 state 对象为单元；内部换成 SQLite 事务存储。
// 好处：真正的原子事务 + 多进程并发安全（多标签页/server/cli 同时写不串数据）。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// node:sqlite 在 Node 22 仍是实验特性，加载前拦截其「实验性」提示（其余警告照常）。
const _origEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (msg.indexOf('SQLite is an experimental feature') !== -1) return;
  return _origEmitWarning.call(process, warning, ...args);
};
const { DatabaseSync } = await import('node:sqlite');

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DB = join(__dirname, 'data.db');
export const DATA_VERSION = 1;

// UI 状态字段（存 meta.ui，任务/目标/设置进专门表）
const UI_KEYS = ['sortMode', 'view', 'filter', 'calYear', 'calMonth', 'selectedDay', 'editingId', 'editingPrio'];

const db = new DatabaseSync(DATA_DB);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 2,
  project TEXT NOT NULL DEFAULT '',
  nature TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  created_day TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  goal_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  quarter TEXT NOT NULL DEFAULT '',
  dimension TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS goal_docs (
  goal_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (goal_id, ord)
);
CREATE TABLE IF NOT EXISTS goal_doc_audio (
  goal_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  audio TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT '',
  audio_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (goal_id, ord)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function defaultState() {
  return {
    version: DATA_VERSION,
    tasks: [],
    goals: [],
    settings: {
      base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat',
      projects: ['架构师Agent', 'MAF数据迁移', '稽查虾'],
      natures: ['探索类', '交付类', '学习类']
    }
  };
}

export function normalize(d) {
  if (!d || typeof d !== 'object') throw new Error('bad data');
  d.version = DATA_VERSION;
  d.tasks = (Array.isArray(d.tasks) ? d.tasks : []).map((t) => {
    if (t && typeof t === 'object' && !t.due) t.due = t.createdDay || todayStr();
    return t;
  });
  d.goals = Array.isArray(d.goals) ? d.goals : [];
  if (!d.settings || typeof d.settings !== 'object') d.settings = defaultState().settings;
  else {
    d.settings.projects = Array.isArray(d.settings.projects) ? d.settings.projects : [];
    d.settings.natures = Array.isArray(d.settings.natures) ? d.settings.natures : [];
  }
  return d;
}

function metaGet(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
function metaSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function readTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY rowid').all().map((r) => ({
    id: r.id, title: r.title, priority: r.priority, project: r.project, nature: r.nature,
    due: r.due, createdDay: r.created_day, createdAt: r.created_at,
    done: !!r.done, doneAt: r.done_at || null, goalId: r.goal_id || ''
  }));
}

function readGoals() {
  const goals = db.prepare('SELECT * FROM goals ORDER BY rowid').all().map((r) => ({
    id: r.id, quarter: r.quarter, dimension: r.dimension, category: r.category,
    title: r.title, link: r.link, status: r.status, note: r.note, createdAt: r.created_at, docs: []
  }));
  const byId = new Map(goals.map((g) => [g.id, g]));
  const audByKey = new Map();
  for (const a of db.prepare('SELECT * FROM goal_doc_audio').all()) {
    audByKey.set(a.goal_id + ':' + a.ord, a);
  }
  for (const doc of db.prepare('SELECT * FROM goal_docs ORDER BY ord').all()) {
    const g = byId.get(doc.goal_id);
    if (!g) continue;
    const a = audByKey.get(doc.goal_id + ':' + doc.ord);
    g.docs.push({
      ord: doc.ord,
      title: doc.title,
      url: doc.url,
      audio: a ? { voice: a.voice, audio: a.audio, fetchedAt: a.fetched_at, audioAt: a.audio_at } : null
    });
  }
  return goals;
}

export function load() {
  const d = {
    version: DATA_VERSION,
    tasks: readTasks(),
    goals: readGoals(),
    settings: defaultState().settings
  };
  const s = metaGet('settings');
  if (s) { try { d.settings = JSON.parse(s); } catch (e) {} }
  const ui = metaGet('ui');
  if (ui) { try { Object.assign(d, JSON.parse(ui)); } catch (e) {} }
  return normalize(d);
}

export function save(data) {
  const d = normalize(data);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM tasks');
    const insTask = db.prepare('INSERT INTO tasks (id,title,priority,project,nature,due,created_day,created_at,done,done_at,goal_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const t of d.tasks) {
      insTask.run(t.id, t.title || '', t.priority == null ? 2 : t.priority, t.project || '', t.nature || '',
        t.due || '', t.createdDay || '', t.createdAt || '', t.done ? 1 : 0, t.doneAt || null, t.goalId || '');
    }
    db.exec('DELETE FROM goal_docs'); db.exec('DELETE FROM goals');
    const insGoal = db.prepare('INSERT INTO goals (id,quarter,dimension,category,title,link,status,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const insDoc = db.prepare('INSERT INTO goal_docs (goal_id,ord,title,url) VALUES (?,?,?,?)');
    for (const g of d.goals) {
      insGoal.run(g.id, g.quarter || '', g.dimension || '', g.category || '', g.title || '',
        g.link || '', g.status || 'todo', g.note || '', g.createdAt || '');
      (Array.isArray(g.docs) ? g.docs : []).forEach((doc, i) => insDoc.run(g.id, i, doc.title || '', doc.url || ''));
    }
    metaSet('settings', JSON.stringify(d.settings || {}));
    const ui = {};
    for (const k of UI_KEYS) if (d[k] !== undefined && d[k] !== null) ui[k] = d[k];
    metaSet('ui', JSON.stringify(ui));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// —— 读书笔记语音（正文 + 生成音频的绑定），由 server 的 /api/doc/tts 维护，
//    不参与前端 goals 的整表回写，避免前端 save 时把正文/音频抹掉。
export function getDoc(goalId, ord) {
  const row = db.prepare('SELECT goal_id, ord, title, url FROM goal_docs WHERE goal_id = ? AND ord = ?').get(goalId, ord);
  return row || null;
}

export function getDocAudio(goalId, ord) {
  const row = db.prepare('SELECT * FROM goal_doc_audio WHERE goal_id = ? AND ord = ?').get(goalId, ord);
  if (!row) return null;
  return { content: row.content, audio: row.audio, voice: row.voice, fetchedAt: row.fetched_at, audioAt: row.audio_at };
}

export function setDocAudio(goalId, ord, data) {
  db.prepare(
    `INSERT INTO goal_doc_audio (goal_id, ord, content, audio, voice, fetched_at, audio_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(goal_id, ord) DO UPDATE SET
       content = excluded.content,
       audio = excluded.audio,
       voice = excluded.voice,
       fetched_at = excluded.fetched_at,
       audio_at = excluded.audio_at`
  ).run(goalId, ord, data.content || '', data.audio || '', data.voice || '', data.fetchedAt || '', data.audioAt || '');
}
