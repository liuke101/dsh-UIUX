#!/usr/bin/env node
/**
 * Extracts the `--dsw-*` / `--dsh-*` design tokens that style the Web client.
 *
 * Parses every stylesheet under `packages/client/ui-theme/src/styles/`, records
 * each custom-property declaration with its selector (so the light and dark
 * values of one token stay distinct), and joins the result with the component
 * usage counts from `components.json`. Writes `data/tokens.json`.
 *
 * Usage: node tools/extract-tokens.mjs [--root <repoRoot>]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Catalog directory (this script lives in its `tools/`). */
const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(CATALOG, 'data')

const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--root')

/** Nearest ancestor holding the theme stylesheets this catalog documents. */
function findCheckout(start) {
  let dir = start
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'packages/client/ui-theme/src/styles'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : (findCheckout(CATALOG) ?? process.cwd())
const STYLE_DIR = join(ROOT, 'packages/client/ui-theme/src/styles')
if (!existsSync(STYLE_DIR)) {
  console.error(
    `extract-tokens: no ui-theme stylesheets under ${ROOT}. ` +
      'Run this script from <checkout>/UIUX/tools/ or pass --root <checkout>.',
  )
  process.exit(1)
}

/** Token families, in reporting order. */
const CATEGORIES = [
  ['--dsw-static-', 'static', '静态色板', '与主题无关的原始色阶，语义别名从这些值派生。'],
  ['--dsw-alias-', 'alias', '语义别名', '按用途命名的颜色，浅色与深色主题各有一套取值。'],
  ['--dsw-specific-', 'specific', '专属表面', '侧边栏、气泡、菜单等特定表面的填充色。'],
  ['--dsw-radius-', 'radius', '圆角', '全局圆角阶梯，配合 corner-shape 超椭圆。'],
  ['--dsw-font-', 'typography', '字体排印', '字号 / 行高 / 字重的组合变量。'],
  ['--dsw-elevation-', 'elevation', '浮层描边与投影', '0.5px 发丝描边 + 柔光的三件套。'],
  ['--dsw-shadow-', 'shadow', '阴影', '通用投影层级。'],
  ['--dsw-linear-gradient-', 'gradient', '渐变', '选区与深度思考的线性渐变。'],
  ['--dsw-gradient-', 'gradient', '渐变', '开场动画渐变。'],
  ['--dsw-menu-', 'material', '菜单材质', '菜单面的半透明填充与背景模糊。'],
  ['--dsw-mask-', 'material', '遮罩', '模态遮罩的模糊策略。'],
  ['--dsw-focus-ring-', 'focus', '焦点环', '键盘焦点描边的宽度与颜色。'],
  ['--dsw-corner-shape', 'shape', '圆角形状', '超椭圆平滑参数。'],
  ['--dsh-', 'host', '宿主变量', '滚动条、字体栈、内容字号等上游变量。'],
  ['--ds-', 'host', '宿主变量', '宿主层的基础变量：等宽字体栈与全局动画曲线。'],
]

/** @returns {string | null} the category key of a token name. */
function categoryOf(name) {
  for (const [prefix, key] of CATEGORIES) {
    if (name === prefix || name.startsWith(prefix)) return key
  }
  return null
}

/** Splits a stylesheet into `{ selector, body, line }` rules, in file order. */
function rules(text) {
  const out = []
  let index = 0
  let depth = 0
  let selectorStart = 0
  let bodyStart = -1
  while (index < text.length) {
    const char = text[index]
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }
    if (char === '{') {
      if (depth === 0) bodyStart = index + 1
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && bodyStart >= 0) {
        out.push({
          selector: text.slice(selectorStart, text.indexOf('{', selectorStart)).trim().replace(/\s+/g, ' '),
          body: text.slice(bodyStart, index),
          offset: bodyStart,
        })
        selectorStart = index + 1
        bodyStart = -1
      }
    }
    index += 1
  }
  return out
}

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length
}

function main() {
  const files = readdirSync(STYLE_DIR).filter((name) => name.endsWith('.css')).sort()
  /** @type {Map<string, {name: string, category: string|null, declarations: object[]}>} */
  const tokens = new Map()
  for (const name of files) {
    const path = join(STYLE_DIR, name)
    const text = readFileSync(path, 'utf8')
    for (const rule of rules(text)) {
      for (const match of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const tokenName = match[1]
        // `--dsw-*` are the design system's own; `--dsh-*` and `--ds-*` are the
        // host variables the sheets consume (font stacks, motion curve, radii).
        if (!tokenName.startsWith('--dsw-') && !tokenName.startsWith('--dsh-') && !tokenName.startsWith('--ds-')) continue
        if (!tokens.has(tokenName)) {
          tokens.set(tokenName, { name: tokenName, category: categoryOf(tokenName), declarations: [] })
        }
        tokens.get(tokenName).declarations.push({
          value: match[2].trim().replace(/\s+/g, ' '),
          selector: rule.selector,
          file: relative(ROOT, path),
          line: lineOf(text, rule.offset + match.index),
          dark: /dark/.test(rule.selector),
        })
      }
    }
  }

  const componentsPath = join(DATA_DIR, 'components.json')
  const usage = new Map()
  if (existsSync(componentsPath)) {
    const inventory = JSON.parse(readFileSync(componentsPath, 'utf8'))
    for (const component of inventory.components) {
      for (const token of component.tokens) {
        if (!usage.has(token)) usage.set(token, { count: 0, packages: new Set(), components: [] })
        const entry = usage.get(token)
        entry.count += 1
        entry.packages.add(component.package.replace(/^packages\//, ''))
        if (entry.components.length < 12) entry.components.push(component.name)
      }
    }
  }

  const list = [...tokens.values()].map((token) => {
    const light = token.declarations.find((d) => !d.dark)
    const dark = token.declarations.find((d) => d.dark)
    const used = usage.get(token.name)
    return {
      name: token.name,
      category: token.category,
      light: light?.value ?? null,
      dark: dark?.value ?? null,
      declarations: token.declarations,
      usageCount: used?.count ?? 0,
      usedByPackages: used ? [...used.packages].sort() : [],
      usedByComponents: used?.components ?? [],
    }
  })

  const grouped = {}
  for (const [prefix, key, label, description] of CATEGORIES) {
    const items = list.filter((token) => token.category === key)
    if (items.length === 0) continue
    grouped[key] = { key, label, description, count: items.length, tokens: items }
  }

  writeFileSync(
    join(DATA_DIR, 'tokens.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceDir: relative(ROOT, STYLE_DIR),
        totals: { tokens: list.length, categories: Object.keys(grouped).length, used: list.filter((t) => t.usageCount > 0).length },
        groups: grouped,
        tokens: list,
      },
      null,
      1,
    )}\n`,
  )
  console.log(`tokens=${list.length} groups=${Object.keys(grouped).length} used=${list.filter((t) => t.usageCount > 0).length}`)
}

main()
