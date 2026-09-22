// today-todo server —— 零依赖本地服务
// 1) 托管 index.html（网页 UI）
// 2) 提供 /api/state，让网页与 CLI 共用同一份 data.json
// 启动：node server.mjs  （默认 http://localhost:3210）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data.json');
const PORT = Number(process.env.PORT) || 3210;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function defaultState() {
  return {
    tasks: [],
    goals: [],
    settings: { base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat' }
  };
}
function normalize(raw) {
  const d = JSON.parse(raw);
  if (!d || typeof d !== 'object') throw new Error('bad data');
  d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
  d.goals = Array.isArray(d.goals) ? d.goals : [];
  return d;
}
function load() {
  if (!existsSync(DATA_FILE)) return defaultState();
  try {
    return normalize(readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('[today-todo] data.json 解析失败，尝试从 .bak 恢复:', e.message);
    const bak = DATA_FILE + '.bak';
    if (existsSync(bak)) {
      try { return normalize(readFileSync(bak, 'utf8')); }
      catch (e2) { console.error('[today-todo] .bak 也损坏:', e2.message); }
    }
    return defaultState();
  }
}
function save(data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  // 落盘前先备份当前文件
  if (existsSync(DATA_FILE)) {
    try { copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) { console.error('备份失败:', e.message); }
  }
  // 原子写：先写临时文件再 rename，避免中途崩溃损坏 data.json
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, DATA_FILE);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path === '/api/state') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(load()));
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (!d || typeof d !== 'object') throw new Error('bad body');
          d.goals = load().goals || []; // 今日待办页面不管理 goals，避免覆盖丢失
          save(d);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{"ok":false}');
        }
      });
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  if (path === '/api/goals') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ goals: load().goals || [] }));
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (!d || typeof d !== 'object') throw new Error('bad body');
          const existing = load();
          existing.goals = Array.isArray(d.goals) ? d.goals : [];
          save(existing);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{"ok":false}');
        }
      });
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  if (path === '/api/month') {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const month = (url.searchParams.get('month') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"ok":false,"error":"bad month"}');
      return;
    }
    const cur = load();
    let arch = [];
    const fp = join(__dirname, 'data-' + month + '.json');
    if (existsSync(fp)) {
      try { arch = JSON.parse(readFileSync(fp, 'utf8')); } catch (e) { arch = []; }
    }
    if (!Array.isArray(arch)) arch = [];
    const seen = new Set();
    const merged = [];
    const monthTasks = cur.tasks.filter((t) => t.due && t.due.slice(0, 7) === month);
    for (const t of arch.concat(monthTasks)) {
      if (!t || !t.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      merged.push(t);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ tasks: merged }));
    return;
  }

  // 静态文件
  const rel = path === '/' ? '/index.html' : (path === '/goals' ? '/goals.html' : path);
  const fp = join(__dirname, rel);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!existsSync(fp)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});

server.listen(PORT, () => {
  console.log('today-todo 已启动：');
  console.log('  网页  http://localhost:' + PORT);
  console.log('  数据  ' + DATA_FILE);
});
