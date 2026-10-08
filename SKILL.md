# 今日待办 · AI 操作技能（Skill）

> 本文件是给 **AI 助手**读的操作手册：当需要操作「今日待办」项目时（加待办、查待办、改标签、设置目标、记录学习、排优先级等），先读本文件，再按下面规则执行。
> 相关文档：`docs/ARCHITECTURE.md`（结构/红线）、`docs/FEATURES.md`（功能规则）、`docs/API.md`（接口细节）。

---

## 0. 何时使用本技能

用户（或你自己）要操作「今日待办」时使用，典型诉求：

- 「帮我加个待办」「记一下 …」
- 「这条设成 P1」「把 … 的项目改成 …」「截止改到 …」
- 「把 … 标记完成」「删掉 …」
- 「加个目标」「这个季度学 …」
- 「今天学了 …」/「查一下我的待办 / 目标 / 学习」

---

## 1. 硬性规则（务必逐条遵守）

1. **只在项目根目录运行 CLI**：`/Users/ling/IdeaProjects/today-todo`，命令一律 `node src/cli.mjs ...`。
2. **绝不直接碰 `data.db`**：不用 sqlite3 等外部工具读写、不跑 `PRAGMA wal_checkpoint`、不另开写库路径。所有写入走 CLI 或 `store.mjs`。
3. **优先用 CLI 而不是手改 JSON 或 curl**：CLI 内部是「先 `load()` → 改 → `save()`」，能保证字段完整、顺序正确、自动写前备份。
4. **截止日期 `due` 必填**：新建默认「今天」。日期用系统本地日期（`date +%F`），格式 `YYYY-MM-DD`。
5. **优先级取值 P0–P3**（也可 0–3）：P0 紧急 / P1 高 / P2 中 / P3 低；默认 P2。
6. **定位任务用 `list` 的 `[n]`（1 起始）或完整 id**；`[n]` 只对「未完成」排序结果有效。
7. **改后端代码要重启 server**；改前端静态文件不需要（页面 `no-store`，强刷即可）。
8. 先 `list` 拿到编号，再改；**不要凭记忆猜编号**。

---

## 2. 数据模型速查

```text
任务 task:   { priority:0|1|2|3, project, nature, due, done, goalId }
目标 goal:   { quarter:"YYYY-QN", dimension:"内功|战功", category, title, link,
               status:"todo|doing|done", note, docs:[] }
学习 learn:  { entries:[{date,content,...}], reviews:{"YYYY-QN":"内容"} }
```

- 项目 `project`、性质 `nature`：自由文本；默认候选 = 架构师Agent / MAF数据迁移 / 稽查虾；探索类 / 交付类 / 学习类。
- 目标状态：`todo` 未开始 / `doing` 进行中 / `done` 已完成。
- 目标维度：`内功`（能力）/ `战功`（交付）。

---

## 3. 操作手册

### 3.1 加待办

```bash
node src/cli.mjs add "标题" --project=XX --nature=YY --due=YYYY-MM-DD --prio=P1
```

- 一次可多条：`add "A" "B" "C"`（多条共用同一组标签）。
- 未写 `--due` 时默认今天；未写 `--prio` 默认 P2。
- 批量：`printf "A\nB\n" | node src/cli.mjs add --project=XX`。

### 3.2 查待办

```bash
node src/cli.mjs list          # 未完成(带编号+逾期天数) + 已完成
node src/cli.mjs export        # Markdown（含标签，便于粘贴/阅读）
```

### 3.3 改标签

```bash
node src/cli.mjs prio    <编号|id> <P0..P3>       # 优先级
node src/cli.mjs project <编号|id> <名称|none>    # 项目
node src/cli.mjs nature  <编号|id> <名称|none>    # 性质
node src/cli.mjs due     <编号|id> [YYYY-MM-DD]   # 截止（缺省今天）
node src/cli.mjs tag     <编号|id> project=.. nature=.. due=.. prio=..   # 一次改多个
```

### 3.4 完成 / 恢复 / 删除 / 排序

```bash
node src/cli.mjs done <编号|id>
node src/cli.mjs undo <编号|id>
node src/cli.mjs rm   <编号|id>
node src/cli.mjs sort [priority|due|created|late]
node src/cli.mjs clear-done
```

### 3.5 归档 / 导出

```bash
node src/cli.mjs archive [YYYY-MM]   # 已完成移到 data-YYYY-MM.json；缺省归档所有已过月份
node src/cli.mjs export              # Markdown 到 stdout
```

### 3.6 设置目标（中期目标）

```bash
node src/cli.mjs goal-list [YYYY-QN|all]           # 先看现有目标
node src/cli.mjs goal-add "标题" --quarter=2026-Q4 --dimension=内功 --category=书籍阅读 --status=doing --note="..."
node src/cli.mjs goal-status <id|编号|标题关键词> <todo|doing|done>
node src/cli.mjs goal-rm   <id|编号|标题关键词>
```

- 目标定位优先级：**完整 id → 编号（当前季度列表 [n]）→ 唯一标题关键词**。
- 目标命令只管理目标本身，**不含读书笔记章节和音频**。

### 3.7 记录学习

```bash
node src/cli.mjs learn-add "今天学到的内容"
node src/cli.mjs learn-list [YYYY-MM-DD|YYYY-MM]
```

---

## 4. 自然语言 → 命令 示例

| 用户说 | 执行 |
|---|---|
| 「加个待办：明天发周报，项目架构师Agent，P1」 | `node src/cli.mjs add "发周报" --project=架构师Agent --prio=P1 --due=<明天日期>` |
| 「这条设成 P0」 | `node src/cli.mjs prio <编号> P0` |
| 「把 maf 迁移那条截止改到 9/30」 | 先 `list` 定位 → `node src/cli.mjs due <编号> 2026-09-30` |
| 「X 做完了」 | `node src/cli.mjs done <编号>` |
| 「加个 Q4 目标：读完《XX》，内功，进行中」 | `node src/cli.mjs goal-add "读完《XX》" --quarter=2026-Q4 --dimension=内功 --category=书籍阅读 --status=doing` |
| 「今天学了 3 条」 | 逐条 `node src/cli.mjs learn-add "..."` |
| 「我的待办有哪些」 | `node src/cli.mjs list` |

---

## 5. 常见陷阱

1. **编号会变**：`[n]` 是未完成排序后的顺序，删/改后编号会变；每次操作前先 `list`。
2. **多条标签**：`add "A" "B"` 会共用同一组 `--project/--nature/--due/--prio`；要不同标签就分次 add。
3. **项目/性质是自由文本**：别把「项目」和「性质」搞混（项目=哪摊事，性质=探索/交付/学习）。
4. **归档只动「已完成」**：未完成任务永远留在库里，不会被 archive 移走。
5. **不要手动 checkpoint**：曾因此触发整表被清空的事故；一切写入走 CLI。
6. **日期别写错**：截止日期是 `YYYY-MM-DD`，用系统当天日期（`date +%F`），不要用错月份/年份。
