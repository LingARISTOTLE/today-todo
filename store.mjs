// store.mjs —— data.json 唯一读写入口（server.mjs / cli.mjs 共用）
// 提供：默认结构、schema 归一化/迁移、版本戳、原子写 + 备份 + 损坏恢复
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = join(__dirname, 'data.json');
export const DATA_VERSION = 1;

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

// 归一化 + 迁移：补 version、回填截止日期、兜底数组
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

export function load() {
  if (!existsSync(DATA_FILE)) return defaultState();
  try {
    return normalize(JSON.parse(readFileSync(DATA_FILE, 'utf8')));
  } catch (e) {
    console.error('[today-todo] data.json 解析失败，尝试从 .bak 恢复:', e.message);
    const bak = DATA_FILE + '.bak';
    if (existsSync(bak)) {
      try { return normalize(JSON.parse(readFileSync(bak, 'utf8'))); }
      catch (e2) { console.error('[today-todo] .bak 也损坏:', e2.message); }
    }
    return defaultState();
  }
}

export function save(data) {
  const d = normalize(data);
  const json = JSON.stringify(d, null, 2) + '\n';
  // 落盘前先备份当前文件
  if (existsSync(DATA_FILE)) {
    try { copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) { console.error('备份失败:', e.message); }
  }
  // 原子写：先写临时文件再 rename，避免中途崩溃损坏 data.json
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, DATA_FILE);
}
