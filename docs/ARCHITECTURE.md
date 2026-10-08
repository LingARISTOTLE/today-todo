# 今日待办 · 架构与结构文档

> 本文档回答「这个项目是怎么组织的、数据怎么存、数据怎么流转、有哪些不能碰的红线」。
> 面向：后续要维护、扩展、或让 AI 操作这个项目的读者。

## 1. 项目定位

零依赖的本地「今日待办 + 成长」工具。三个网页模块 + 一个 CLI 共用同一份本地 SQLite 数据库 `data.db`：

| 模块 | 入口 | 职责 |
|---|---|---|
| 今日待办 | `public/todo/`，路径 `/` | 列表 + 月度日历，管理待办任务 |
| 中期目标 | `public/goals/`，路径 `/goals` | 内功/战功目标 + 读书笔记 + 语音朗读 |
| 今天学了吗 | `public/learn/`，路径 `/learn` | 每日学习日记 + 季度复盘 |
| CLI | `src/cli.mjs` | 命令行增删改查（也是 AI 操作的主入口） |

## 2. 目录结构

```text
today-todo/
├── public/                前端（浏览器加载，server 从这里托管，无需构建）
│   ├── todo/              今日待办：index.html / index.css / index.js / calendar.js
│   ├── goals/             中期目标：goals.html / goals.css / goals.js
│   ├── learn/             今天学了吗：learn.html / learn.css / learn.js
│   └── shared/            共享（被多个页面引用）
│       ├── styles.css     设计令牌（CSS 变量，浅色/深色两套）
│       ├── shared.js      全局函数（$ / esc / uid / applyTheme / toggleTheme / dropdown）
│       ├── utils.js       纯工具函数（ES module：日期 / 格式化）
│       └── holidays.js    中国法定节假日（动态拉取 + 2026 硬编码兜底）
├── src/                   后端（Node 22，零外部依赖）
│   ├── server.mjs         HTTP 服务：静态托管 + 接口 + TTS 生成
│   ├── store.mjs          数据层：SQLite 读写的唯一入口（唯一数据源）
│   └── cli.mjs            命令行工具
├── docs/                  本目录：架构 / 功能 / 接口 / 技能 文档
├── SKILL.md               给 AI 操作本项目的技能说明（playbook）
├── data.db                SQLite 数据库（.gitignore，不上传）
├── data-YYYY-MM.json      已完成任务的归档文件（.gitignore）
├── audio/                 TTS 音频产物（.gitignore）
├── backups/               写前自动快照 data-*.db（.gitignore，最多保留 20 份）
└── package.json           "type":"module"，start=node src/server.mjs
```

## 3. 技术栈与关键依赖

- **零外部 npm 依赖**：没有 node_modules、没有打包器。前端是纯 ES 模块 + 全局脚本。
- **Node 22 内置 `node:sqlite`**（`DatabaseSync`）：SQLite 引擎内置于 Node，无需安装。
- 前端模块分两类：
  - **全局脚本** `shared/shared.js`（普通 `<script>`，先加载，挂到 `window`）；
  - **ES module** `todo/index.js`（`<script type="module">`，`import` 引 `calendar.js`、`shared/utils.js`、`shared/holidays.js`）。
- `package.json` 有 `"type": "module"`，所以 `src/*.mjs` 和 `todo/index.js` 等都用 ESM。

## 4. 数据存储（单一数据源）

**单一数据源 = 项目根目录的 `data.db`**。所有读写必须收敛到 `src/store.mjs`，其它地方不得直接碰数据库。

### 4.1 表结构

| 表 | 用途 | 关键字段 |
|---|---|---|
| `tasks` | 待办任务 | id, title, priority(0-3), project, nature, due, created_day, created_at, done, done_at, goal_id |
| `goals` | 中期目标 | id, quarter, dimension, category, title, link, status, note, created_at |
| `goal_docs` | 目标下的读书笔记章节 | goal_id, ord, title, url |
| `goal_doc_audio` | 笔记的朗读音频绑定 | goal_id, ord, content, audio, voice, fetched_at, audio_at |
| `learn_entries` | 学习日记条目 | id, date, content, created_at, updated_at |
| `learn_reviews` | 季度总结 | quarter, content, updated_at |
| `meta` | 键值：`settings`、`ui` | key, value（JSON 字符串） |

### 4.2 逻辑模型（前端/CLI 看到的样子）

```text
task   = { id, title, priority:0|1|2|3, project, nature, due, createdDay, createdAt, done, doneAt, goalId }
goal   = { id, quarter:"YYYY-QN", dimension:"内功|战功", category, title, link, status:"todo|doing|done", note, createdAt, docs:[{ord,title,url,audio?}] }
learn  = { entries:[{id,date,content,createdAt,updatedAt}], reviews:{"YYYY-QN":"内容"} }
settings = { base, key, model, projects:[], natures:[] }
```

### 4.3 `meta` 表

- `meta.settings`：设置（API 地址/Key/模型/项目列表/性质列表）。
- `meta.ui`：UI 状态字段，键为 `UI_KEYS = [sortMode, view, filter, calYear, calMonth, selectedDay, editingId, editingPrio]`。

> ⚠️ **注意**：`meta.ui` 会被 `load()` 合并进返回的 state，但前端 `applyState()` **并不回读**这些 UI 字段（前端每次加载都用默认值，再按 URL 参数/用户点击确定视图）。这属于「存了但不恢复」的现状，改动 UI 状态持久化时需先确认前端是否回读。

## 5. 数据流

```text
浏览器页面 ──fetch──> server.mjs ──> store.mjs ──> data.db (SQLite)
    ▲                     │                │
    └───── JSON ──────────┘                └──> backups/（写前 VACUUM INTO 快照）

CLI (cli.mjs) ──直接──> store.mjs ──> data.db
```

- 网页只通过 HTTP 接口读写；CLI 直接 import `store.mjs`。
- 两者最终都走 `store.mjs` 的 `load()/save()/saveLearn()`，因此**多标签页 / server / CLI 并发写是安全的**（SQLite WAL + `busy_timeout=5000` + 事务）。

## 6. 写路径的关键机制（务必理解）

`save()` / `saveLearn()` 是**整表全量替换**，流程固定：

1. `backupBeforeWrite()`：先 `VACUUM INTO` 生成一份一致快照到 `backups/data-*.db`（保留最近 20 份，失败不阻塞主流程）。
2. `BEGIN IMMEDIATE`（拿写锁，冲突时按 busy_timeout 等待）。
3. `DELETE FROM <表>` 后逐行 `INSERT`（`ORDER BY rowid` 保留原顺序）。
4. `COMMIT`；异常则 `ROLLBACK` 并抛出。

含义：**任何写操作都必须带上完整 state**（不能只发增量）。CLI 内部已经处理好了（先 `load()` 再改再 `save()`），所以通过 CLI 操作最安全。

## 7. 红线（绝对不要做）

1. **不要直接改 `data.db`**（不要用 sqlite3 等外部工具读写、不要 `PRAGMA wal_checkpoint` 等手动 checkpoint）。曾有外部 checkpoint 导致服务器长连接读到空数据、进而整表被清空的事故。
2. **不要在 `store.mjs` 之外另开一条写数据库的路径**。所有写入走 `save()/saveLearn()`。
3. **数据文件不上 git**：`data.db`、`data.db-wal/-shm`、`data-*.json`、`backups/`、`audio/` 都在 `.gitignore`。
4. **改 `src/*.mjs`（后端）要重启 server 才生效**；改 `public/`（前端）静态文件无需重启（但现在都带 `Cache-Control: no-store`，浏览器强刷即可）。
5. 前端页面不管理 goals（`POST /api/state` 时 server 会用 `load().goals` 覆盖回写，防止误删）；goals 只能走 `/api/goals` 或 goal CLI。

## 8. 服务与端口

- 启动：`node src/server.mjs`（或 `npm start`），默认 `http://localhost:3210`，可用 `PORT` 环境变量覆盖。
- 静态托管映射：`/`→`/todo/index.html`，`/goals`→`/goals/goals.html`，`/learn`→`/learn/learn.html`。
- 接口清单见 `docs/API.md`。

## 9. TTS 语音朗读（仅 goals 模块用到）

- 依赖本机两个可执行文件：`edge-tts`（合成）和 `lark-cli`（抓飞书文档正文），路径在 `server.mjs` 顶部 `findBin()` 里探测。
- 流程：`POST /api/doc/tts` → `fetchDocContent`（lark-cli 拉飞书 markdown）→ `cleanToText` → `chunkText` 分句 → `edge-tts` 逐段合成 → 拼接 mp3 到 `audio/` → `setDocAudio` 绑定。
- 音频绑定存在 `goal_doc_audio`，**不参与**前端 goals 的整表回写（避免被 `save()` 抹掉）。

## 10. 归档机制

- CLI `archive [YYYY-MM]` 把「已完成」任务从 `tasks` 移到 `data-YYYY-MM.json`（按 due/created 的月份归类）；**未完成任务永远留在库里**。
- 日历查看过去月份时，`GET /api/month?month=YYYY-MM` 会把「归档 JSON + 库内当月任务」合并去重返回。
