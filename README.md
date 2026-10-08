# 今日待办（today-todo）

一个**零依赖**的「今日待办 + 成长」工具，多入口共用同一份本地 SQLite 数据库 `data.db`：

1. **今日待办**（`public/todo/`）—— 列表 + 月度日历
2. **中期目标**（`public/goals/`）—— 内功（能力）/ 战功（交付）+ 读书笔记朗读
3. **今天学了吗**（`public/learn/`）—— 每日学习日记 + 季度复盘
4. **CLI**（`src/cli.mjs`）—— 命令行增删改查
5. **AI 助手（我）**—— 直接对话，我帮你加/查/排/打标签

核心针对「一天并行事情太多、忙一件丢一件」：**未完成的任务永远留在列表上并标红拖延天数**；支持四类标签归类；月度日历一眼看清当月节奏。

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 项目结构 + 数据模型 + 数据流 + **红线（绝对不能做的操作）** |
| [docs/FEATURES.md](docs/FEATURES.md) | 三大模块功能点与规则的完整梳理 |
| [docs/API.md](docs/API.md) | CLI 全部命令 + HTTP 接口 + 字段/枚举速查 |
| [SKILL.md](SKILL.md) | **给 AI 看的操作手册**（加待办/改标签/设目标/记学习） |

## 目录结构

```text
today-todo/
├── public/              前端（浏览器加载，server 从这里托管）
│   ├── todo/            今日待办：index.html / index.css / index.js / calendar.js
│   ├── goals/           中期目标：goals.html / goals.css / goals.js
│   ├── learn/           今天学了吗：learn.html / learn.css / learn.js
│   └── shared/          共享：styles.css（设计令牌）/ shared.js（全局）/ utils.js / holidays.js
├── src/                 后端（Node，零依赖）
│   ├── server.mjs       HTTP 服务 + 静态托管 + 接口
│   ├── store.mjs        数据层（SQLite 读写，唯一数据源入口）
│   └── cli.mjs          命令行工具
├── data.db              SQLite 数据库（.gitignore）
├── audio/               TTS 产物（.gitignore）
└── backups/             迁移/归档备份（.gitignore）
```

## 数据存储

单一数据源 = 项目根目录的 `data.db`（SQLite，用 Node 22 内置 `node:sqlite`，零外部依赖；已在 `.gitignore`）。所有读写收敛到 `src/store.mjs`，任务/目标/设置分表存储、事务写入：

```text
tasks / goals / goal_docs / goal_doc_audio / learn_entries / learn_reviews / meta
```

task 逻辑模型 = `{ id, title, priority: 0|1|2|3, project, nature, due, createdDay, createdAt, done, doneAt }`

## 四类标签

| 标签 | 字段 | 取值 |
|---|---|---|
| 优先级 | `priority` | P0 紧急 / P1 高 / P2 中 / P3 低 |
| 项目 | `project` | 架构师Agent / MAF数据迁移 / 稽查虾…（可自定义） |
| 截止日期 | `due` | YYYY-MM-DD |
| 性质 | `nature` | 探索类 / 交付类 / 学习类…（可自定义） |

## 一、网页 UI

```bash
node src/server.mjs      # 或 npm start
# 打开 http://localhost:3210
```

- **列表视图**：输入框回车加任务（**截止日期必填，新建默认今天**）；点 P 标**下拉选优先级**（P0 紧急/P1 高/P2 中/P3 低）；点任务上的标签或「标签」按钮，弹窗编辑「项目 / 截止 / 性质 / 优先级」；双击标题改文字。
- **日历视图**（顶栏「日历」tab，或直接 `?view=cal`）：
  - 当月日历，标记**周末**（灰）、**法定节假日**（绿「休」+ 节日名）、**调休上班**（橙「班」）；
  - 有截止任务的日期显示**角标数量**，点击某天在下方列出当天截止的任务；
  - ‹ › 切换月份，「今天」回到当月。

> 节假日数据**运行时从 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) 拉取**（`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{年份}.json`），跨年自动获取最新放假/调休安排；断网时回退到内置的 2026 年数据（元旦 1/1–1/3、春节 2/15–2/23、清明 4/4–4/6、劳动节 5/1–5/5、端午 6/19–6/21、中秋 9/25–9/27、国庆 10/1–10/7；调休上班 1/4、2/14、2/28、5/9、9/20、10/10）。

## 二、CLI

```bash
node src/cli.mjs add "标题" --project=架构师Agent --prio=P1 --due=2026-09-30 --nature=交付类
node src/cli.mjs list
node src/cli.mjs done <编号|id>          # undo / rm 同
node src/cli.mjs prio <编号|id> P0..P3
node src/cli.mjs project <编号|id> <名称|none>
node src/cli.mjs nature  <编号|id> <名称|none>
node src/cli.mjs due     <编号|id> [YYYY-MM-DD]   # 缺省=今天
node src/cli.mjs tag <编号|id> project=.. nature=.. due=.. prio=..
node src/cli.mjs sort [priority|due|created|late]
node src/cli.mjs clear-done
node src/cli.mjs export

# 目标（中期目标）
node src/cli.mjs goal-list [YYYY-QN|all]
node src/cli.mjs goal-add "标题" [--quarter=.. --dimension=内功|战功 --category=.. --link=.. --note=.. --status=todo|doing|done]
node src/cli.mjs goal-status <id|编号|标题关键词> <todo|doing|done>
node src/cli.mjs goal-rm   <id|编号|标题关键词>

# 学习（今天学了吗）
node src/cli.mjs learn-add "内容"
node src/cli.mjs learn-list [日期]
```

`编号` 用 `list` 里显示的 `[n]`（1 起始），也可用完整 id；`project=xx` 与 `--project=xx` 都行。

## 三、通过对话让 AI 操作

直接对 AI 说人话，AI 会调用上面的 CLI（完整规则见 [SKILL.md](SKILL.md)）：

- 「加个待办：明天发周报，项目架构师Agent，P1」→ `add ... --project=架构师Agent --prio=P1`
- 「把 maf 迁移那条设截止到 9 月 30 号」→ `tag ... due=2026-09-30`
- 「加个 Q4 目标：读完《XX》」→ `goal-add ...`
- 「今天学了 …」→ `learn-add ...`
- 「这个月 20 号要上什么？」→ 读数据库（`src/store.mjs`），按 `due` 答
- 「帮我按优先级排一下」→ AI 直接调优先级/顺序

> 走这条路不需要任何 API Key（AI 由助手本人完成）。

## 四、今天学了吗

两个入口：**今日待办首页的内嵌卡片**（速记 + 连续天数），或独立页 http://localhost:3210/learn（完整编辑 + 复盘）：

- **速记**：每天写一段「今天学到了什么」，可一天多条。
- **日历打卡**：月历里哪天写了会亮一个绿点，空白 = 没记录。
- **连续学习天数**：顶部显示当前连续写了多少天，断更归零。
- **季度复盘**：「季度复盘」tab 看当季「已学习 / 已过 / 未学习」天数，并写季度总结。

> 数据在 `learn_entries` / `learn_reviews` 两张表，同样零依赖、本地 SQLite。

## 关于「AI 排优先级」按钮（网页顶栏 ✨）

网页里的 ✨ 是可选的、需要你自己配 API Key（浏览器内直接调模型）。主要通过对话用 AI 的话，忽略它即可。
