#!/usr/bin/env node
'use strict';

/**
 * 把本项目根目录的 SKILL.md 安装/卸载为 DSH（DeepSeek Harness）技能。
 *
 * DSH 的 filesystem provider 扫描以下技能根（优先级从高到低），
 * 技能为目录束 `<root>/<name>/SKILL.md`，YAML frontmatter 需含 kebab-case `name` 与 `description`：
 *   <project>/.dsh/skills      (rank 100, project-dsh)
 *   <project>/.agents/skills   (rank 200, project-agents)
 *   ~/.dsh/skills              (rank 400, user-dsh)
 *   ~/.agents/skills           (rank 500, user-agents, 本脚本默认)
 *
 * 用法（在本项目根目录运行）：
 *   node scripts/dsh-skill.mjs install   [--scope=user|project]
 *   node scripts/dsh-skill.mjs uninstall [--scope=user|project]
 *   node scripts/dsh-skill.mjs status    [--scope=user|project]
 *
 * --scope 缺省 user（装到 ~/.agents/skills/，全局可用）；
 * project 装到 <项目>/.dsh/skills/（仅在该项目工作区可见，可随 git 提交）。
 * 环境变量 DSH_AGENTS_HOME 可覆盖 agentsHome（缺省 ~/.agents）。
 */

import { mkdir, rm, readFile, writeFile, cp, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'today-todo';
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

function parseScope(argv) {
  for (const a of argv) {
    if (a.startsWith('--scope=')) return a.slice('--scope='.length);
  }
  return 'user';
}

function agentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents');
}

function skillDir(scope) {
  const root = scope === 'project'
    ? join(PROJECT_ROOT, '.dsh', 'skills')
    : join(agentsHome(), 'skills');
  return join(root, NAME);
}

function frontmatter() {
  return `---
name: ${NAME}
description: >
  MUST USE when the user wants to 操作「今日待办」项目（加/查/改待办、设优先级 P0-P3、
  改项目/性质标签、改截止、标记完成/删除/恢复/排序、管理中期目标、记录学习、归档导出）。
  触发词：待办、今日待办、记一下、帮我加个待办、设成 P1、标记完成、我的待办、目标、今天学了。
  规则：一律在 ${PROJECT_ROOT} 用 node src/cli.mjs 操作，禁止直接读写 data.db。
---
`;
}

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function install(scope) {
  const dir = skillDir(scope);
  const src = join(PROJECT_ROOT, 'SKILL.md');
  if (!(await exists(src))) {
    throw new Error('未找到源文件：' + src);
  }
  // 先清空再写入，保证幂等（不残留旧文件）
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const body = await readFile(src, 'utf8');
  await writeFile(join(dir, 'SKILL.md'), frontmatter() + body, 'utf8');
  // 复制 docs/，让 SKILL.md 里的相对路径 docs/... 在技能目录内可解析
  const srcDocs = join(PROJECT_ROOT, 'docs');
  if (await exists(srcDocs)) {
    await cp(srcDocs, join(dir, 'docs'), { recursive: true });
  }
  console.log('✅ 已安装技能 [' + NAME + '] → ' + dir);
  console.log('   scope=' + scope + (scope === 'user' ? '（全局可用）' : '（仅该项目工作区可见）'));
  console.log('   DSH 会热发现；若当前会话未出现，新开会话即可在 available_skills 中看到。');
}

async function uninstall(scope) {
  const dir = skillDir(scope);
  const marker = join(dir, 'SKILL.md');
  if (!(await exists(marker))) {
    if (!(await exists(dir))) {
      console.log('ℹ️ 未安装（' + dir + ' 不存在）。');
      return;
    }
  } else {
    // 安全校验：只删名字匹配的技能目录，防止误删
    const content = await readFile(marker, 'utf8');
    if (!/^---\s*\nname:\s*today-todo\b/m.test(content)) {
      throw new Error('目标 SKILL.md 不是 today-todo 技能，拒绝删除：' + dir);
    }
  }
  await rm(dir, { recursive: true, force: true });
  console.log('🗑 已卸载技能 [' + NAME + ']（删除 ' + dir + '）。');
}

async function status(scope) {
  const dir = skillDir(scope);
  const marker = join(dir, 'SKILL.md');
  if (await exists(marker)) {
    const s = await stat(marker);
    console.log('✅ 已安装：' + dir);
    console.log('   scope=' + scope + ' · SKILL.md ' + s.size + ' 字节 · ' + s.mtime.toISOString());
  } else {
    console.log('○ 未安装：' + dir);
  }
}

const cmd = process.argv[2] || 'status';
const scope = parseScope(process.argv.slice(3));
try {
  if (cmd === 'install') await install(scope);
  else if (cmd === 'uninstall') await uninstall(scope);
  else if (cmd === 'status') await status(scope);
  else {
    console.error('用法：node scripts/dsh-skill.mjs install|uninstall|status [--scope=user|project]');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('❌ ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
