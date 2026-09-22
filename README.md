# 今日待办（today-todo）

一个**零依赖**的「今日待办」工具，三个入口共用同一份本地数据 `data.json`：

1. **网页 UI**（`index.html`）—— 列表 + 月度日历
2. **CLI**（`cli.mjs`）—— 命令行增删改查
3. **AI 助手（我）**—— 直接对话，我帮你加/查/排/打标签

核心针对「一天并行事情太多、忙一件丢一件」：**未完成的任务永远留在列表上并标红拖延天数**；支持四类标签归类；月度日历一眼看清当月节奏。

## 数据存储

单一数据源 = 项目根目录的 `data.json`（已在 `.gitignore`）：

```json
{ "tasks": [ { "id", "title", "priority": 0|1|2|3, "project", "nature", "due", "createdDay", "createdAt", "done", "doneAt" } ], "settings": {...} }
```

## 四类标签

| 标签 | 字段 | 取值 |
|---|---|---|
| 优先级 | `priority` | P0 紧急 / P1 高 / P2 中 / P3 低 |
| 项目 | `project` | 架构师Agent / MAF数据迁移 / 稽查虾…（可自定义） |
| 截止日期 | `due` | YYYY-MM-DD |
| 性质 | `nature` | 探索类 / 交付类 / 学习类…（可自定义） |

## 一、网页 UI

```bash
node server.mjs          # 或 npm start
# 打开 http://localhost:3210
```

- **列表视图**：输入框回车加任务（**截止日期必填，新建默认今天**）；点 P 标**下拉选优先级**（P0 紧急/P1 高/P2 中/P3 低）；点任务上的标签或 🏷️ 按钮，弹窗编辑「项目 / 截止 / 性质 / 优先级」；双击标题改文字。
- **日历视图**（顶栏「日历」tab，或直接 `?view=cal`）：
  - 当月日历，标记**周末**（灰）、**法定节假日**（绿「休」+ 节日名）、**调休上班**（橙「班」）；
  - 有截止任务的日期显示**角标数量**，点击某天在下方列出当天截止的任务；
  - ‹ › 切换月份，「今天」回到当月。

> 节假日数据**运行时从 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) 拉取**（`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{年份}.json`），跨年自动获取最新放假/调休安排；断网时回退到内置的 2026 年数据（元旦 1/1–1/3、春节 2/15–2/23、清明 4/4–4/6、劳动节 5/1–5/5、端午 6/19–6/21、中秋 9/25–9/27、国庆 10/1–10/7；调休上班 1/4、2/14、2/28、5/9、9/20、10/10）。

## 二、CLI

```bash
node cli.mjs add "标题" --project=架构师Agent --prio=P1 --due=2026-09-30 --nature=交付类
node cli.mjs list
node cli.mjs done <编号|id>          # undo / rm 同
node cli.mjs prio <编号|id> P0..P3
node cli.mjs project <编号|id> <名称|none>
node cli.mjs nature  <编号|id> <名称|none>
node cli.mjs due     <编号|id> [YYYY-MM-DD]   # 缺省=今天
node cli.mjs tag <编号|id> project=.. nature=.. due=.. prio=..
node cli.mjs sort [priority|due|created|late]
node cli.mjs clear-done
node cli.mjs export
```

`编号` 用 `list` 里显示的 `[n]`（1 起始），也可用完整 id；`project=xx` 与 `--project=xx` 都行。

## 三、通过对话让 AI 操作

直接对 AI 说人话，AI 会调用上面的 CLI：

- 「加个待办：明天发周报，项目架构师Agent，P1」→ `add ... --project=架构师Agent --prio=P1`
- 「把 maf 迁移那条设截止到 9 月 30 号」→ `tag ... due=2026-09-30`
- 「这个月 20 号要上什么？」→ 读 `data.json`，按 `due` 答
- 「帮我按优先级排一下」→ AI 直接调优先级/顺序

> 走这条路不需要任何 API Key（AI 由助手本人完成）。

## 关于「AI 排优先级」按钮（网页顶栏 ✨）

网页里的 ✨ 是可选的、需要你自己配 API Key（浏览器内直接调模型）。主要通过对话用 AI 的话，忽略它即可。
