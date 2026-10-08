# 今日待办 · 接口参考（CLI + HTTP）

> 这是「机器可操作」的入口清单。AI 操作时**优先用 CLI**（内部先 load 再改再 save，最安全）；HTTP 接口主要用于网页和需要精细控制的场景。

所有命令在**项目根目录**执行。CLI 入口：`node src/cli.mjs`。

---

## 一、CLI 命令

### 1. 任务（待办）

```bash
node src/cli.mjs add "标题" ["标题2"...] [--project=XX] [--nature=YY] [--due=YYYY-MM-DD] [--prio=P0|P1|P2|P3]
node src/cli.mjs list
node src/cli.mjs done <编号|id>
node src/cli.mjs undo <编号|id>
node src/cli.mjs rm   <编号|id>
node src/cli.mjs prio    <编号|id> <P0..P3|0..3>
node src/cli.mjs project <编号|id> <名称|none>
node src/cli.mjs nature  <编号|id> <名称|none>
node src/cli.mjs due     <编号|id> [YYYY-MM-DD]          # 缺省=今天
node src/cli.mjs tag     <编号|id> [project=..] [nature=..] [due=..] [prio=..]
node src/cli.mjs sort    [priority|due|created|late]
node src/cli.mjs clear-done
node src/cli.mjs archive [YYYY-MM]
node src/cli.mjs export
node src/cli.mjs help
```

规则：

- `编号` = `list` 输出的 `[n]`（1 起始，仅针对**未完成**排序后的顺序）；也可用完整 UUID id。
- `add` 无标题参数时从 stdin 按行读入批量添加；`--prio` 也可写 `0..3`。
- `tag` 的 `project=xx` 等价于 `--project=xx`；`project/nature` 设 `none` 表示清空。
- `add` 默认：priority=P2、due=今天、project/nature 空。
- `archive [YYYY-MM]`：把已完成任务移到 `data-YYYY-MM.json`；缺省归档所有已过月份；未完成不动。
- `export`：输出 Markdown（未完成含标签+逾期标记，已完成列出标题）。

### 2. 目标（中期目标）

```bash
node src/cli.mjs goal-list [YYYY-QN|all]                 # 缺省=当前季度
node src/cli.mjs goal-add "标题" [--quarter=YYYY-QN] [--dimension=内功|战功] [--category=XX] [--link=URL] [--note=XX] [--status=todo|doing|done]
node src/cli.mjs goal-status <id|编号|标题关键词> <todo|doing|done>
node src/cli.mjs goal-rm   <id|编号|标题关键词>
```

规则：

- `goal-add` 默认：quarter=当前季度、dimension=内功、status=todo、category/link/note 空。
- 目标定位优先级：**完整 id → 编号（当前季度列表的 [n]）→ 唯一标题关键词**。
- 状态取值：`todo`(未开始) / `doing`(进行中) / `done`(已完成)。
- 目标命令只管理目标本身，**不含笔记章节（docs）和音频**（那些走 Web UI + `/api/doc/tts`）。

### 3. 学习（今天学了吗）

```bash
node src/cli.mjs learn-add "内容"                       # 记一条今天的学习
node src/cli.mjs learn-list [YYYY-MM-DD|YYYY-MM]        # 列出学习日记，可按日期过滤
```

- `learn-add` 把内容写到今天（`date=todayStr()`），一天可多条。
- `learn-list` 不带参数列出全部（按日期倒序分组）；带日期精确/前缀过滤。

---

## 二、HTTP 接口

Base：`http://localhost:3210`。所有 JSON 响应；数据读接口均带 `Cache-Control: no-store`。

### 2.1 `GET /api/state`

返回完整 state：

```json
{ "version":1, "tasks":[...], "goals":[...], "settings":{...},
  "sortMode":"priority","view":"cal","filter":"all","calYear":2026,"calMonth":9,"selectedDay":"2026-10-08", ... }
```

> `sortMode/view/filter/...` 等 UI 字段来自 `meta.ui`，仅作持久化，前端不回读。

### 2.2 `POST /api/state`

请求体 = 完整 state（`tasks` 等）。**注意**：server 会强制用 `load().goals` 覆盖请求里的 `goals`（防止今日待办页面误删目标）。返回 `{"ok":true}`。

### 2.3 `GET /api/goals` → `{ "goals": [...] }`

### 2.4 `POST /api/goals`

请求体 `{ "goals": [...] }`，**全量替换** goals（先 load 现有 state，再覆盖 goals，再 save）。返回 `{"ok":true}`。

### 2.5 `GET /api/learn` → `{ "entries":[...], "reviews":{...} }`

### 2.6 `POST /api/learn`

请求体 `{ "entries":[...], "reviews":{...} }`，全量替换学习数据。返回 `{"ok":true}`。

### 2.7 `GET /api/month?month=YYYY-MM`

返回某月的任务（归档 JSON + 库内当月任务合并去重）：`{ "tasks":[...] }`。

### 2.8 `POST /api/doc/tts`

请求体 `{ "goal_id":"...", "ord":0, "voice":"zh-CN-XiaoxiaoNeural" }`，为某目标某篇笔记生成朗读音频。返回 `{ "ok":true, "audio":"/audio/...mp3", ... }`（依赖本机 `edge-tts` + `lark-cli`）。

---

## 三、数据模型 JSON（字段速查）

```text
task: { id, title, priority, project, nature, due, createdDay, createdAt, done, doneAt, goalId }
goal: { id, quarter, dimension, category, title, link, status, note, createdAt,
        docs:[{ ord, title, url, audio:{voice,audio,fetchedAt,audioAt}|null }] }
learn: { entries:[{ id, date, content, createdAt, updatedAt }],
         reviews:{ "YYYY-QN":"内容" } }
```

### 枚举

- 优先级 `priority`：`0`=P0 紧急、`1`=P1 高、`2`=P2 中、`3`=P3 低。
- 目标维度 `dimension`：`内功` | `战功`。
- 目标状态 `status`：`todo`(未开始) | `doing`(进行中) | `done`(已完成)。
- 季度格式：`YYYY-QN`（N=1..4）。
- 日期格式：`YYYY-MM-DD`（本地系统时区）。
