#!/usr/bin/env node
/**
 * Validates the curated catalog entries against the repository source.
 *
 * The appearance specimens are only faithful while every class they use exists
 * in a stylesheet the entry declares, and while every declared token exists in
 * the theme. This checks those two mechanically, plus required fields, unique
 * ids, source paths, and line numbers.
 *
 * Usage: node tools/validate.mjs [--root <repoRoot>] [--quiet]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--root')

/** Catalog directory (this script lives in its `tools/`). */
const CATALOG = join(HERE, '..')
const DATA = join(CATALOG, 'data')

/**
 * Source tree the entries point at: the nearest ancestor holding the client
 * packages, so the same checks run from `<checkout>/UIUX/` and from a
 * published catalog repository.
 */
function findCheckout(start) {
  let dir = start
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'packages/client'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : (findCheckout(CATALOG) ?? join(CATALOG, '..'))
const QUIET = argv.includes('--quiet')

const REQUIRED = ['id', 'name', 'exportName', 'zh', 'group', 'summary', 'source', 'css', 'specimens']

/** A part file being rewritten by another process is reported, not thrown. */
const unreadable = []

/** @returns {object | null} the parsed file, or null when it is unreadable. */
function parsePart(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    unreadable.push(`${path}: ${error.message}`)
    return null
  }
}
const GROUP_ALIASES = new Set([
  'controls', 'display', 'input', 'overlay', 'output', 'settings', 'brand',
  'conversation', 'shell', 'preview', 'dock', 'tools', 'panels', 'overlays', 'agent',
])

/** @returns {object[]} every curated entry, tagged with its source file. */
function entries() {
  const out = []
  const push = (file, list) => {
    for (const entry of list ?? []) out.push({ ...entry, __file: file })
  }
  const main = join(DATA, 'primitives.json')
  if (existsSync(main)) push('primitives.json', JSON.parse(readFileSync(main, 'utf8')).entries)
  const parts = join(DATA, 'parts')
  if (existsSync(parts)) {
    for (const name of readdirSync(parts).filter((file) => file.endsWith('.json')).sort()) {
      const part = parsePart(join(parts, name))
    if (part) push(`parts/${name}`, part.entries)
    }
  }
  return out
}

const cssCache = new Map()
/** Class names a stylesheet declares, ignoring `:global()` wrappers. */
function classesOf(relPath) {
  if (cssCache.has(relPath)) return cssCache.get(relPath)
  const path = join(ROOT, relPath)
  const found = new Set()
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) found.add(match[1])
  }
  cssCache.set(relPath, found)
  return found
}

/** Class names an HTML fragment applies, with any explicit module prefix removed. */
function classesUsed(html) {
  const used = new Set()
  for (const match of String(html ?? '').matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) {
    for (const name of (match[1] ?? match[2] ?? '').split(/\s+/)) if (name) used.add(name.replace(/^c\d+-/, ''))
  }
  return used
}

/** Class-name string literals the component and its siblings in the same directory apply. */
function literalClasses(sourcePath) {
  const key = `lit:${sourcePath}`
  if (cssCache.has(key)) return cssCache.get(key)
  const found = new Set()
  const directory = dirname(join(ROOT, sourcePath))
  const siblings = [join(ROOT, sourcePath)]
  try {
    for (const name of readdirSync(directory)) {
      if (/\.tsx?$/.test(name)) siblings.push(join(directory, name))
    }
  } catch {
    /* a missing directory leaves only the entry's own source */
  }
  for (const file of new Set(siblings)) {
    if (!existsSync(file)) continue
    // `clsx(css.block, 'md-code-block', …)` and `className = 'task-list-item'`.
    for (const match of readFileSync(file, 'utf8').matchAll(/['"]([a-z][\w-]*)['"]/g)) found.add(match[1])
  }
  cssCache.set(key, found)
  return found
}

const tokenNames = new Set()
const tokensPath = join(DATA, 'tokens.json')
if (existsSync(tokensPath)) {
  for (const token of JSON.parse(readFileSync(tokensPath, 'utf8')).tokens) tokenNames.add(token.name)
}

const problems = [...unreadable.map((line) => `无法解析：${line}`)]
const report = (entry, message) => problems.push(`${entry.__file} · ${entry.id ?? '(no id)'}: ${message}`)

const list = entries()
const seenIds = new Map()
let specimenCount = 0

for (const entry of list) {
  for (const field of REQUIRED) {
    if (entry[field] == null) report(entry, `缺少必填字段 ${field}`)
    else if (Array.isArray(entry[field]) && entry[field].length === 0 && field !== 'css') report(entry, `${field} 为空`)
  }
  if (entry.id) {
    if (seenIds.has(entry.id)) report(entry, `id 与 ${seenIds.get(entry.id)} 重复`)
    seenIds.set(entry.id, entry.__file)
  }
  if (entry.group && !GROUP_ALIASES.has(entry.group)) report(entry, `未知分组 ${entry.group}`)

  // Source path and line.
  if (entry.source) {
    const [file, lineText] = String(entry.source).split('#L')
    const path = join(ROOT, file)
    if (!existsSync(path)) report(entry, `源码不存在 ${file}`)
    else if (lineText) {
      const total = readFileSync(path, 'utf8').split('\n').length
      if (Number(lineText) > total) report(entry, `行号 ${lineText} 超出 ${file}（共 ${total} 行）`)
    }
  }

  // Declared stylesheets exist.
  const declared = new Set()
  for (const cssPath of entry.css ?? []) {
    if (!existsSync(join(ROOT, cssPath))) report(entry, `样式表不存在 ${cssPath}`)
    else for (const name of classesOf(cssPath)) declared.add(name)
  }

  // Tokens are either declared by the theme or genuinely consumed by one of the
  // entry's own stylesheets. Some aliases (for example --dsw-alias-bg-layer-4)
  // come from the upstream platform theme rather than this repository's sheets,
  // so the entry's own CSS is the second authority.
  const consumed = new Set()
  for (const cssPath of entry.css ?? []) {
    if (!existsSync(join(ROOT, cssPath))) continue
    for (const match of readFileSync(join(ROOT, cssPath), 'utf8').matchAll(/var\(\s*(--[\w-]+)/g)) consumed.add(match[1])
  }
  for (const token of entry.tokens ?? []) {
    if (!token.startsWith('--')) report(entry, `设计变量命名异常 ${token}`)
    else if (tokenNames.size > 0 && !tokenNames.has(token) && !consumed.has(token)) {
      report(entry, `设计变量既未在主题声明、也不在条目样式表中出现 ${token}`)
    }
  }

  // Every class a specimen uses must be declared by the entry's stylesheets or
  // by its own state-demo CSS.
  const literals = entry.source ? literalClasses(String(entry.source).split('#L')[0]) : new Set()

  for (const specimen of entry.specimens ?? []) {
    specimenCount += 1
    const local = new Set()
    for (const match of String(specimen.css ?? '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) local.add(match[1].replace(/^c\d+-/, ''))
    for (const name of classesUsed(specimen.html)) {
      // A class is accounted for when a listed stylesheet declares it, when the
      // specimen's own state CSS declares it, or when the component (or a
      // renderer beside it) applies it as a literal class string.
      if (!declared.has(name) && !local.has(name) && !literals.has(name)) {
        report(entry, `示例「${specimen.label ?? ''}」使用了未声明的类 .${name}`)
      }
    }
  }
}

const totalSpecimens = list.reduce((sum, entry) => sum + (entry.specimens?.length ?? 0), 0)
if (!QUIET) {
  const byFile = {}
  for (const entry of list) byFile[entry.__file] = (byFile[entry.__file] ?? 0) + 1
  console.log(`entries=${list.length} specimens=${totalSpecimens}`)
  for (const [file, count] of Object.entries(byFile).sort()) console.log(`  ${file}: ${count}`)
}
if (problems.length === 0) {
  console.log('validate: ok — 所有条目的类名、变量、源码路径与必填字段均通过')
} else {
  console.log(`validate: ${problems.length} 处问题`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exitCode = 1
}
