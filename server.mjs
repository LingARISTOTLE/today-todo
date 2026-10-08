// today-todo server —— 零依赖本地服务
// 1) 托管 index.html（网页 UI）
// 2) 提供 /api/state，让网页与 CLI 共用同一份 data.json
// 启动：node server.mjs  （默认 http://localhost:3210）
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { load, save, DATA_DB, getDoc, setDocAudio } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3210;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon'
};

const execFileAsync = promisify(execFile);
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

// —— 语音合成相关工具 ——

// 找可执行文件：优先环境变量，其次扫 PATH，再兜底常见绝对路径
function findBin(name, extra) {
  const envKey = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_BIN';
  const candidates = [];
  if (process.env[envKey]) candidates.push(process.env[envKey]);
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir) candidates.push(join(dir, name));
  }
  for (const p of (extra || [])) candidates.push(p);
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return c; } catch (e) {}
  }
  return name; // 兜底：让 execFile 走 PATH
}

const EDGE_TTS_BIN = findBin('edge-tts', [
  join(homedir(), '.agent-reach-venv', 'bin', 'edge-tts'),
  join(homedir(), 'Library', 'Python', '3.10', 'bin', 'edge-tts'),
  '/opt/homebrew/bin/edge-tts',
  '/usr/local/bin/edge-tts'
]);
const LARK_CLI_BIN = findBin('lark-cli', [
  join(homedir(), '.nvm', 'versions', 'node', 'v22.23.1', 'bin', 'lark-cli')
]);

// 从飞书云文档实时拉取正文（markdown）
async function fetchDocContent(url) {
  const { stdout } = await execFileAsync(LARK_CLI_BIN,
    ['docs', '+fetch', '--doc', url, '--doc-format', 'markdown', '--scope', 'full'],
    { maxBuffer: 32 * 1024 * 1024 });
  const j = JSON.parse(stdout);
  const content = j && j.data && j.data.document && j.data.document.content;
  if (typeof content !== 'string' || !content) throw new Error('未能读取飞书文档正文');
  return content;
}

// 把 markdown / 飞书扩展标签清洗成适合朗读的纯文本
function cleanToText(md) {
  let s = String(md || '');
  s = s.replace(/```[\s\S]*?```/g, '（此处为代码示例，已省略）');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  s = s.replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '');
  s = s.replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1$2');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1$2');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// 按句子边界分块，避免一句话被截断
function chunkText(text, size) {
  const n = size || 1200;
  const parts = (text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) || [text])
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > n) { chunks.push(cur); cur = ''; }
    cur += p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function sanitizeName(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

async function synthChunk(text, voice, outPath) {
  await execFileAsync(EDGE_TTS_BIN,
    ['--voice', voice, '--text', text.replace(/\s+/g, ' ').trim(), '--write-media', outPath],
    { maxBuffer: 16 * 1024 * 1024 });
}

function concatMp3(paths, outPath) {
  writeFileSync(outPath, Buffer.concat(paths.map((p) => readFileSync(p))));
}

// 生成一条笔记的音频：实时抓飞书正文 → 清洗 → 分句合成 → 拼接 → 绑定记录
async function generateAudio(goalId, ord, voice) {
  const doc = getDoc(goalId, ord);
  if (!doc || !doc.url) throw new Error('未找到对应笔记记录');
  const md = await fetchDocContent(doc.url);
  const text = cleanToText(md);
  if (!text) throw new Error('笔记正文为空');
  const chunks = chunkText(text, 1200);

  const audioDir = join(__dirname, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const base = sanitizeName(goalId) + '__' + ord + '__' + sanitizeName(voice);
  const finalRel = '/audio/' + base + '.mp3';
  const finalPath = join(audioDir, base + '.mp3');

  const tmpPaths = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const tmp = join(audioDir, base + '.part' + i + '.mp3');
      await synthChunk(chunks[i], voice, tmp);
      tmpPaths.push(tmp);
    }
    concatMp3(tmpPaths, finalPath);
  } finally {
    for (const t of tmpPaths) { try { unlinkSync(t); } catch (e) {} }
  }

  const now = new Date().toISOString();
  setDocAudio(goalId, ord, { content: text, audio: finalRel, voice, fetchedAt: now, audioAt: now });
  return { audio: finalRel, voice, chars: text.length, fetchedAt: now, audioAt: now, chunks: chunks.length };
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

  if (path === '/api/doc/tts') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      (async () => {
        try {
          const d = JSON.parse(body || '{}');
          const goalId = String(d.goal_id || '');
          const ord = Number(d.ord);
          const voice = String(d.voice || DEFAULT_VOICE);
          if (!goalId || Number.isNaN(ord)) throw new Error('参数错误');
          const out = await generateAudio(goalId, ord, voice);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, ...out }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
        }
      })();
    });
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
  console.log('  数据  ' + DATA_DB);
});
