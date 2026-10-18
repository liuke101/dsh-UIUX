#!/usr/bin/env node
/**
 * Builds the UIUX HTML catalog from the extracted inventory, the token
 * extraction, and the curated component specimens.
 *
 * Every specimen renders inside a declarative shadow root, so the component's
 * own CSS Module source applies verbatim without leaking into the catalog and
 * without a build step. Design tokens inherit into the shadow tree from the
 * catalog body, which is why one theme switch recolors every preview.
 *
 * Usage: node tools/build.mjs [--root <repoRoot>]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--root')

/** The catalog directory: this script lives in its `tools/`. */
const CATALOG = join(HERE, '..')
const DATA = join(CATALOG, 'data')
const OUT = CATALOG

/**
 * Checkout holding the documented sources. The catalog is layout-independent —
 * it resolves at `<checkout>/UIUX/` while generating and at a repository root
 * once published — so the stylesheets it inlines are found by walking up from
 * the catalog directory rather than by assuming a fixed depth.
 */
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

/**
 * Where a source reference points. The default resolves against the upstream
 * repository so a published copy's links work; `--source-base local` emits the
 * relative path a sibling checkout uses instead.
 */
const UPSTREAM = 'https://github.com/deepseek-ai/deepseek-harness/blob/master/'
const baseFlag = argv.indexOf('--source-base')
const SOURCE_BASE =
  baseFlag >= 0 ? (['local', 'relative', 'none'].includes(argv[baseFlag + 1]) ? null : argv[baseFlag + 1]) : UPSTREAM

/** Absolute upstream URL, or the relative path when no base is configured. */
function sourceHref(path, line) {
  const suffix = line == null ? '' : `#L${line}`
  return SOURCE_BASE == null ? `../${path}${suffix}` : `${SOURCE_BASE}${path}${suffix}`
}

const checkout = findCheckout(CATALOG)
const ROOT = rootFlag >= 0 ? argv[rootFlag + 1] : (checkout ?? join(CATALOG, '..'))
if (checkout == null && rootFlag < 0) {
  console.warn(
    'warning: no deepseek-harness checkout above this directory; component stylesheets cannot be read, ' +
      'so previews will be empty. Pass --root <checkout> or run from <checkout>/UIUX/.',
  )
}

const read = (path) => readFileSync(path, 'utf8')
const readJson = (path) => (existsSync(path) ? JSON.parse(read(path)) : null)

const inventory = readJson(join(DATA, 'components.json'))
const tokens = readJson(join(DATA, 'tokens.json'))

/** Curated entries: the hand-written exemplars plus every delegated part file. */
function curatedEntries() {
  const entries = [...(readJson(join(DATA, 'primitives.json'))?.entries ?? [])]
  const partsDir = join(DATA, 'parts')
  if (existsSync(partsDir)) {
    for (const name of readdirSync(partsDir).filter((file) => file.endsWith('.json')).sort()) {
      const part = readJson(join(partsDir, name))
      for (const entry of part?.entries ?? []) entries.push(entry)
    }
  }
  const seen = new Set()
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      console.warn(`duplicate entry id dropped: ${entry.id}`)
      return false
    }
    seen.add(entry.id)
    return true
  })
}

const curated = curatedEntries()
/** The shared library lives in one package; everything else is product surface. */
const isPrimitivePackage = (entry) => String(entry.source ?? '').startsWith('packages/client/ui-primitives/')
const primitives = curated.filter(isPrimitivePackage)
const product = curated.filter((entry) => !isPrimitivePackage(entry))

/** `package::Component` → the gallery page and anchor documenting it. */
const curatedIndex = new Map()
for (const entry of curated) {
  const pkg = String(entry.source ?? '').split('/src/')[0]
  if (!pkg || !entry.name) continue
  curatedIndex.set(`${pkg}::${entry.name}`, {
    href: `${isPrimitivePackage(entry) ? 'primitives' : 'product'}.html#${entry.id}`,
    zh: entry.zh ?? '',
  })
}

/** Escapes text for HTML text nodes and quoted attributes. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const cssCache = new Map()

/**
 * Reads a CSS Module and rewrites the few constructs that cannot resolve inside
 * a shadow root: `:global(...)` wrappers, `:root`/`html`/`body` selectors.
 * @returns {string} the stylesheet text as applied to a specimen.
 */
function moduleCss(relPath) {
  const key = relPath
  if (cssCache.has(key)) return cssCache.get(key)
  let text = ''
  try {
    text = read(join(ROOT, relPath))
  } catch {
    text = `/* missing stylesheet: ${relPath} */`
  }
  text = text
    .replace(/:global\(([^)]*)\)/g, '$1')
    .replace(/(^|\})\s*:root\b/g, '$1 :host')
    .replace(/(^|\})\s*html\[[^\]]*\]\s+body\b/g, '$1 :host')
    .replace(/(^|\})\s*html\b/g, '$1 :host')
    .replace(/(^|\})\s*body\b/g, '$1 :host')
    .replace(/body\[/g, ':host([')
  cssCache.set(key, text)
  return text
}

/**
 * Preview-harness reset, placed before the component's own stylesheet inside
 * every shadow root so component rules still win. Form controls do not inherit
 * `font-family` from their ancestors (the UA stylesheet gives them the platform
 * UI font), and a machine without a CJK face installed renders every Chinese
 * label inside a button, input or select as tofu. The real product relies on the
 * operating system's CJK font here; the catalog supplies the embedded subset.
 */
const PREVIEW_RESET = 'button, input, select, textarea { font-family: inherit; }\n'

const escapeClass = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Class names a stylesheet declares, `:global(...)` included. */
function classNamesOf(relPath) {
  const key = `names:${relPath}`
  if (cssCache.has(key)) return cssCache.get(key)
  const names = new Set()
  for (const match of moduleCss(relPath).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(match[1])
  cssCache.set(key, names)
  return names
}

/**
 * An entry that inlines more than one CSS Module needs every module's class
 * names kept apart. The product hashes them per module, so `.root` in
 * `ReasoningRow.module.css` and `.root` in `DisclosureRow.module.css` are
 * different selectors; inlined verbatim into one shadow root they would merge
 * and cross-apply. Rewriting each module's classes with a per-file prefix
 * restores per-module isolation and lets an entry name the owning module
 * explicitly where the markup alone cannot say which one an element belongs to.
 *
 * A bare class name that several listed modules declare resolves to all of
 * them, in listed order — the cascade an entry's own `css` array already
 * encodes, and what those specimens were checked against.
 * @returns {{files: string[], owners: Map<string, number[]>} | null}
 */
function classPlan(entry) {
  const files = entry.css ?? []
  if (files.length < 2) return null
  const owners = new Map()
  files.forEach((file, index) => {
    for (const name of classNamesOf(file)) {
      if (!owners.has(name)) owners.set(name, [])
      owners.get(name).push(index)
    }
  })
  return { files, owners }
}

/** Indices of the modules declaring a class name; empty when none does. */
function ownersOf(plan, name) {
  return plan.owners.get(name) ?? []
}

/** Rewrites one module's class selectors, leaving `:global(...)` selectors global. */
function prefixModuleCss(text, index, names) {
  const globals = []
  let out = text.replace(/:global\(([^)]*)\)/g, (_match, inner) => {
    globals.push(inner)
    return `\u0000g${globals.length - 1}\u0000`
  })
  for (const name of names) {
    out = out.replace(new RegExp(`\\.${escapeClass(name)}(?![-\\w])`, 'g'), `.c${index}-${name}`)
  }
  return out.replace(/\u0000g(\d+)\u0000/g, (_match, at) => globals[Number(at)])
}

/** Owner named by an already-prefixed class token (`c1-root`), or -1. */
function explicitOwner(plan, token) {
  const match = /^c(\d+)-(.+)$/.exec(token)
  if (!match) return -1
  const index = Number(match[1])
  if (index >= plan.files.length) return -1
  return classNamesOf(plan.files[index]).has(match[2]) ? index : -1
}

/** Rewrites the class attributes of a specimen to the prefixed names. */
function prefixHtml(html, plan) {
  return String(html ?? '').replace(/class="([^"]*)"/g, (_match, value) => {
    const mapped = value
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((name) => {
        // An author names the owning module explicitly (`c1-root`) when a class
        // exists in several of the entry's stylesheets but this element belongs
        // to one specific module. Such a token is kept verbatim.
        if (explicitOwner(plan, name) >= 0) return [name]
        const owners = ownersOf(plan, name)
        if (owners.length === 0) return [name]
        return owners.map((owner) => `c${owner}-${name}`)
      })
    return `class="${mapped.join(' ')}"`
  })
}

/** Rewrites the class selectors of a specimen's own state-demo CSS. */
function prefixSpecimenCss(css, plan) {
  return String(css ?? '').replace(/\.(-?[_a-zA-Z][\w-]*)/g, (match, name) => {
    if (explicitOwner(plan, name) >= 0) return match
    const owners = ownersOf(plan, name)
    if (owners.length === 0) return match
    // `:is()` keeps the specificity of a single class while matching any of the
    // modules' prefixed names.
    return owners.length === 1 ? `.c${owners[0]}-${name}` : `:is(${owners.map((owner) => `.c${owner}-${name}`).join(', ')})`
  })
}

/** Specimen CSS: the entry's real stylesheets plus any state-demo additions. */
function specimenCss(entry, specimen) {
  const plan = classPlan(entry)
  const parts = [PREVIEW_RESET]
  ;(entry.css ?? []).forEach((path, index) => {
    const text = moduleCss(path)
    parts.push(`/* ${path} */\n${plan ? prefixModuleCss(text, index, classNamesOf(path)) : text}`)
  })
  if (specimen.css) {
    parts.push(`/* 状态演示附加样式 */\n${plan ? prefixSpecimenCss(specimen.css, plan) : specimen.css}`)
  }
  return parts.join('\n')
}

/** Warns when injected markup could end its own `<style>` or `<template>` early. */
function guardInjection(entry, css, html) {
  if (/<\/style/i.test(css)) console.warn(`entry ${entry.id}: specimen CSS contains "</style" and will break the shadow root`)
  if (/<\/template/i.test(html)) console.warn(`entry ${entry.id}: specimen HTML contains "</template" and will break the shadow root`)
  if (/<script/i.test(html)) console.warn(`entry ${entry.id}: specimen HTML contains a <script> tag, which the catalog does not execute`)
}

/** Renders one preview stage as a declarative shadow root. */
function stage(specimen, entry) {
  const css = specimenCss(entry, specimen)
  const plan = classPlan(entry)
  const html = plan ? prefixHtml(specimen.html, plan) : specimen.html
  guardInjection(entry, css, html)
  const bg = specimen.bg ?? 'layer1'
  const pad = specimen.pad ?? 'md'
  return `<figure class="spec">
  <figcaption>${esc(specimen.label)}${specimen.note ? ` <span class="spec-note">${esc(specimen.note)}</span>` : ''}</figcaption>
  <div class="stage" data-bg="${esc(bg)}" data-pad="${esc(pad)}">
    <template shadowrootmode="open"><style>${css}</style>${html}</template>
  </div>
</figure>`
}

/** Renders the props table of one curated entry. */
function propsTable(entry) {
  if (!entry.props?.length) return ''
  const rows = entry.props
    .map(
      (prop) => `<tr><td><code>${esc(prop.name)}</code></td><td><code class="ty">${esc(prop.type)}</code></td><td>${esc(prop.default ?? '—')}</td><td>${esc(prop.desc ?? '')}</td></tr>`,
    )
    .join('\n')
  return `<details class="props"><summary>Props（${entry.props.length}）</summary>
<table><thead><tr><th>属性</th><th>类型</th><th>默认</th><th>说明</th></tr></thead><tbody>
${rows}
</tbody></table></details>`
}

/** Renders one curated catalog card. */
function card(entry) {
  const source = entry.source ?? ''
  const [file, line] = source.split('#L')
  const tokens = (entry.tokens ?? []).map((token) => `<code class="tok">${esc(token)}</code>`).join('')
  return `<article class="card" id="${esc(entry.id)}" data-search="${esc([entry.name, entry.zh, entry.exportName, entry.id, ...(entry.tokens ?? []), ...(entry.keywords ?? [])].join(' ').toLowerCase())}">
  <header class="card-head">
    <div class="card-title">
      <h3>${esc(entry.zh ?? entry.name)}</h3>
      <code class="var">${esc(entry.exportName ?? entry.name)}</code>
    </div>
    <a class="src" href="${esc(sourceHref(file, line))}" target="_blank" rel="noreferrer">${esc(file)}${line ? `:${esc(line)}` : ''}</a>
  </header>
  <p class="summary">${entry.summary ?? ''}</p>
  <div class="specs">
${(entry.specimens ?? []).map((specimen) => stage(specimen, entry)).join('\n')}
  </div>
  ${entry.notes ? `<p class="notes">${entry.notes}</p>` : ''}
  ${propsTable(entry)}
  ${tokens ? `<div class="tokrow"><span class="toklabel">设计变量</span>${tokens}</div>` : ''}
  ${entry.docs ? `<a class="doclink" href="${esc(sourceHref(entry.docs))}" target="_blank" rel="noreferrer">实现说明 ↗</a>` : ''}
</article>`
}

/* ------------------------------------------------------------------ chrome */

/** Family name of the embedded CJK subset; see tools/font.mjs. */
const CJK_FAMILY = 'DSH Catalog CJK'
const CJK_RE = /[\u2018\u2019\u201c\u201d\u2026\u3000-\u303f\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * `@font-face` rules for the embedded subset, or '' while the assets are absent.
 * The subset is embedded as base64 so a page stays readable when copied alone.
 */
function fontCss() {
  // The subset belongs to the catalog, not to the checkout it documents, so it
  // is read from beside this script even when --root points somewhere else.
  const assets = join(CATALOG, 'assets')
  const faces = []
  for (const weight of ['400', '500']) {
    const path = join(assets, `cjk-${weight}.woff2`)
    if (!existsSync(path)) continue
    const base64 = readFileSync(path).toString('base64')
    faces.push(
      `@font-face{font-family:'${CJK_FAMILY}';font-style:normal;font-weight:${weight};font-display:swap;` +
        `src:url(data:font/woff2;base64,${base64}) format('woff2')}`,
    )
  }
  if (faces.length === 0) return ''
  return `${faces.join('\n')}
body {
  --dsw-font-family: '${CJK_FAMILY}', var(--dsh-font-family-text, var(--dsh-font-family-text-default)), var(--dsh-font-family-text-default);
  --ds-font-family-code: '${CJK_FAMILY}', var(--dsh-font-family-code, var(--dsh-font-family-code-default)), var(--dsh-font-family-code-default);
}`
}

/**
 * Characters the rendered pages need but the embedded subset does not cover.
 * A non-empty result means tools/font.mjs must run before the pages are final.
 */
function missingGlyphs(pages) {
  const assets = join(CATALOG, 'assets')
  const covered = new Set()
  const charsetPath = join(DATA, 'cjk-charset.txt')
  if (existsSync(charsetPath) && existsSync(join(assets, 'cjk-400.woff2'))) {
    for (const char of readFileSync(charsetPath, 'utf8')) covered.add(char)
  }
  const needed = new Set()
  for (const [, html] of pages) {
    for (const char of html) if (CJK_RE.test(char)) needed.add(char)
  }
  return [...needed].filter((char) => !covered.has(char)).sort()
}

const STYLE_SHEETS = [
  'packages/client/ui-theme/src/styles/base.css',
  'packages/client/ui-theme/src/styles/design-platform.css',
  'packages/client/ui-theme/src/styles/gradient-shadow-text.css',
  'packages/client/ui-theme/src/styles/scrollbar.css',
  'packages/client/ui-theme/src/styles/corner-shape.css',
  'packages/client/ui-theme/src/styles/focus.css',
]

/** Design tokens of the product itself, so the catalog matches the product. */
function themeCss() {
  return STYLE_SHEETS.map((path) => `/* ${path} */\n${read(join(ROOT, path))}`).join('\n')
}

const CATALOG_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
  background: var(--dsw-alias-bg-base);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--dsw-alias-link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; text-decoration-style: dotted; }
code { font-family: var(--ds-font-family-code); }
button, input, select, textarea { font-family: inherit; }
.layout { display: grid; grid-template-columns: 248px minmax(0, 1fr); gap: 32px; max-width: 1560px; margin: 0 auto; padding: 0 32px 96px; }
@media (max-width: 1080px) { .layout { grid-template-columns: minmax(0, 1fr); } .rail { display: none; } }

.masthead { grid-column: 1 / -1; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 40px 0 24px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); margin-bottom: 32px; flex-wrap: wrap; }
.masthead h1 { margin: 0 0 6px; font: var(--dsw-font-xl-24); letter-spacing: -0.01em; }
.masthead p { margin: 0; color: var(--dsw-alias-label-tertiary); max-width: 78ch; }
.masthead .meta { color: var(--dsw-alias-label-caption); font: var(--dsw-font-xxs-12); text-align: right; white-space: nowrap; }
.brandmark { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.brandmark svg { display: block; }

/* Top-right controls: the repository link and the palette switch. The column
   stretches to the masthead's height so the buttons sit in the corner while the
   snapshot metadata stays on the baseline; growing along the main axis keeps
   them flush right when the masthead wraps on a narrow viewport. */
.masthead-side { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 14px; align-self: stretch; }
.topbar { display: flex; align-items: center; gap: 8px; }
.iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; cursor: pointer;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary);
}
.iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); text-decoration: none; }
.iconbtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.iconbtn svg { display: block; }
.iconbtn .i-moon, body[data-ds-dark-theme] .iconbtn .i-sun { display: none; }
body[data-ds-dark-theme] .iconbtn .i-moon { display: block; }

.rail { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; padding-right: 8px; }
.rail h2 { font: var(--dsw-font-xxs-strong-12); text-transform: uppercase; letter-spacing: 0.08em; color: var(--dsw-alias-label-caption); margin: 22px 0 8px; }
.rail h2:first-child { margin-top: 0; }
.rail a { display: block; padding: 5px 8px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xs-13); }
.rail a:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); text-decoration: none; }
.rail a .n { color: var(--dsw-alias-label-caption); float: right; font: var(--dsw-font-xxs-12); }
.rail .home { font-weight: 500; color: var(--dsw-alias-label-primary); }
.rail .home.is-active { background: var(--dsw-alias-interactive-bg-hover); }
/* The sections of a page hang off it: a hairline runs down the branch, and the
   one the reader is in is filled in. */
.rail .leaves { margin: 0 0 6px 13px; padding-left: 6px; border-left: 0.5px solid var(--dsw-alias-border-l2); }
.rail .leaf { padding: 3px 8px; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-tertiary); }
.rail .leaf.is-current { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 500; }

.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 22px; flex-wrap: wrap; }
.toolbar input[type=search] {
  flex: 1 1 260px; min-width: 200px; height: 36px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14); outline: none;
}
.toolbar input[type=search]:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-alias-state-business-primary); }
.toolbar button, .toolbar select {
  height: 36px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14); cursor: pointer;
}
.toolbar button:hover, .toolbar select:hover { background: var(--dsw-alias-interactive-bg-hover); }
.count { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xs-13); margin-left: auto; }

.section { margin: 0 0 44px; scroll-margin-top: 24px; }
.section > h2 { font: var(--dsw-font-l-20); margin: 0 0 6px; }
.section > .lead { margin: 0 0 20px; color: var(--dsw-alias-label-tertiary); max-width: 92ch; }
.cards { display: grid; gap: 20px; }

.card { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); padding: 20px 22px 18px; }
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.card-title { display: flex; align-items: baseline; gap: 10px; }
.card-title h3 { margin: 0; font: var(--dsw-font-l-20); font-size: 17px; }
.var { font-size: 12px; padding: 2px 8px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-markdown-inline-code); color: var(--dsw-alias-label-secondary); }
.src { font: var(--dsw-font-xxs-12); font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-caption); }
.summary { margin: 10px 0 0; color: var(--dsw-alias-label-secondary); max-width: 100ch; }
.notes { margin: 10px 0 0; padding-left: 12px; border-left: 2px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xs-13); }

.specs { display: flex; flex-wrap: wrap; gap: 18px; margin: 18px 0 4px; }
.spec { margin: 0; min-width: 0; }
.spec figcaption { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-caption); margin-bottom: 6px; }
.spec-note { color: var(--dsw-alias-label-dimmed); }
/* A specimen stage is the containing block for whatever the component CSS
   positions. Without it, an absolutely positioned inset-0 overlay inside a
   component whose caller normally supplies the positioned wrapper resolves
   against the initial containing block and covers the viewport — and a
   full-viewport backdrop-filter layer is enough to make Chromium stop painting
   the page altogether. The isolation keeps a specimen's negative z-index
   layers inside their own stage as well. */
.stage { position: relative; isolation: isolate; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); padding: 20px; display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; min-width: 120px; }
.stage[data-bg=layer1] { background: var(--dsw-alias-bg-layer-1); }
.stage[data-bg=layer2] { background: var(--dsw-alias-bg-layer-2); }
.stage[data-bg=platform] { background: var(--dsw-alias-bg-module-platform); }
.stage[data-bg=sidebar] { background: var(--dsw-specific-sidebar-fill); }
.stage[data-bg=toast] { background: var(--dsw-alias-toast-bg); }
.stage[data-bg=dark] { background: var(--dsw-static-neutral-bluish-900); }
.stage[data-bg=none] { background: transparent; }
.stage[data-pad=lg] { padding: 32px; }
.stage[data-pad=sm] { padding: 10px; }
.stage[data-align=start] { justify-content: flex-start; align-items: flex-start; }

.props { margin: 14px 0 0; }
.props summary { cursor: pointer; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xs-13); }
.props table { border-collapse: collapse; width: 100%; margin-top: 10px; font: var(--dsw-font-xs-13); }
.props th, .props td { text-align: left; padding: 6px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); vertical-align: top; }
.props th { color: var(--dsw-alias-label-caption); font-weight: 500; }
.props td code { color: var(--dsw-alias-label-primary); }
.props td code.ty { color: var(--dsw-alias-label-tertiary); }

.tokrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 14px; }
.toklabel { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-caption); margin-right: 4px; }
.tok { font-size: 11px; padding: 1px 6px; border-radius: var(--dsw-radius-xs); background: var(--dsw-specific-tip); color: var(--dsw-alias-label-tertiary); }
.doclink { display: inline-block; margin-top: 12px; font: var(--dsw-font-xs-13); }

table.grid { width: 100%; border-collapse: collapse; font: var(--dsw-font-xs-13); table-layout: fixed; }
table.grid th, table.grid td { text-align: left; padding: 7px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); vertical-align: top; overflow-wrap: anywhere; }
table.grid thead th { position: sticky; top: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-caption); font-weight: 500; z-index: 2; }
table.grid tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
table.grid td.mono { font-family: var(--ds-font-family-code); color: var(--dsw-alias-label-secondary); font-size: 11px; }
table.grid td.dim { color: var(--dsw-alias-label-tertiary); }
table.grid td .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
table.grid col.c-name { width: 14%; }
table.grid col.c-doc { width: 22%; }
table.grid col.c-kind { width: 9%; }
table.grid col.c-src { width: 19%; }
table.grid col.c-props { width: 11%; }
table.grid col.c-css { width: 12%; }
table.grid col.c-tok { width: 5%; }
table.grid col.c-pub { width: 8%; }
table.grid.packages col.c-pkg { width: 60%; }
.pill { display: inline-block; padding: 1px 7px; border-radius: 999px; corner-shape: round; font-size: 11px; white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.pill.k-primitive { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); }
.pill.k-icon, .pill.k-artwork { background: var(--dsw-specific-tip); color: var(--dsw-alias-label-tertiary); }
.pill.k-experimental, .pill.k-extension { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-label); }
td .zh { color: var(--dsw-alias-label-caption); font: var(--dsw-font-xxxs-11); margin-left: 4px; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 0 0 28px; }
.stat { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 14px 16px; }
.stat b { display: block; font: var(--dsw-font-l-20); }
.stat span { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }

.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 12px; }
.swatch { border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md); overflow: hidden; }
.swatch .chip { height: 46px; }
.swatch .chip.split { display: grid; grid-template-columns: 1fr 1fr; }
.swatch .meta { padding: 8px 10px; }
.swatch code { font-size: 11px; color: var(--dsw-alias-label-primary); word-break: break-all; }
.swatch .val { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-caption); word-break: break-all; }
.swatch .use { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.typerow { padding: 10px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
.typerow code { font-size: 11px; color: var(--dsw-alias-label-caption); }
.elev { display: flex; gap: 20px; flex-wrap: wrap; }
.elev > div { width: 190px; height: 96px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); display: flex; align-items: flex-end; padding: 10px; font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-caption); }
.footnote { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xs-13); border-top: 0.5px solid var(--dsw-alias-border-l1); padding-top: 18px; margin-top: 40px; }
.callout { border: 0.5px solid var(--dsw-alias-border-l2); border-left: 2px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-sm); padding: 14px 18px; margin: 0 0 26px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.callout b { color: var(--dsw-alias-label-primary); }
.hidden { display: none !important; }
`

/** The public repository this catalog is published from. */
const REPO_URL = 'https://github.com/liuke101/dsh-UIUX'
const REPO_SLUG = 'liuke101/dsh-UIUX'

/** GitHub's octocat mark; `currentColor` keeps it black on light, white on dark. */
const OCTOCAT =
  '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>'

/** Sun / moon pair; `CATALOG_CSS` shows the one matching the current palette. */
const SUN =
  '<svg class="i-sun" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.15" fill="currentColor"/><g stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 1.05v1.7M8 13.25v1.7M1.05 8h1.7M13.25 8h1.7M3.09 3.09l1.2 1.2M11.71 11.71l1.2 1.2M12.91 3.09l-1.2 1.2M4.29 11.71l-1.2 1.2"/></g></svg>'
const MOON =
  '<svg class="i-moon" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 9.63a5.86 5.86 0 0 1-6.98-6.98.6.6 0 0 0-.79-.7 6.9 6.9 0 1 0 8.47 8.47.6.6 0 0 0-.7-.79Z"/></svg>'

const SCRIPT = `(function () {
  var input = document.querySelector('[data-filter]');
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-search]'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('tbody tr[data-search]'));
  var count = document.querySelector('[data-count]');
  var kindFilter = document.querySelector('[data-kind]');
  var pkgFilter = document.querySelector('[data-pkg]');
  var targets = cards.length ? cards : rows;
  function apply() {
    var q = (input && input.value || '').trim().toLowerCase();
    var kind = kindFilter ? kindFilter.value : '';
    var pkg = pkgFilter ? pkgFilter.value : '';
    var shown = 0;
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      var hay = el.getAttribute('data-search') || '';
      var ok = (!q || hay.indexOf(q) !== -1)
        && (!kind || el.getAttribute('data-kind') === kind)
        && (!pkg || el.getAttribute('data-pkg') === pkg);
      el.classList.toggle('hidden', !ok);
      if (ok) shown++;
    }
    if (count) count.textContent = shown + ' / ' + targets.length;
  }
  if (input) input.addEventListener('input', apply);
  if (kindFilter) kindFilter.addEventListener('change', apply);
  if (pkgFilter) pkgFilter.addEventListener('change', apply);

  // The rail lists every page's sections, so only the anchors of the page being
  // read resolve to an element here; the rest are plain cross-page links. Mark
  // the section the reader is in and keep it inside the rail's own scroll box.
  var leaves = Array.prototype.slice.call(document.querySelectorAll('.rail .leaf[data-section]'));
  var tracked = leaves.map(function (leaf) { return document.getElementById(leaf.getAttribute('data-section')); });
  if (leaves.length) {
    var ticking = false;
    var markCurrent = function () {
      ticking = false;
      var current = -1;
      for (var i = 0; i < tracked.length; i++) {
        if (tracked[i] && tracked[i].getBoundingClientRect().top <= 120) current = i;
      }
      for (var j = 0; j < leaves.length; j++) leaves[j].classList.toggle('is-current', j === current);
      if (current >= 0 && leaves[current].scrollIntoView) {
        leaves[current].scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(markCurrent); }
    }, { passive: true });
    markCurrent();
  }

  // Component CSS that targets the dark palette through a document selector
  // (a :global body[dark] rule) is rewritten into a :host([dark]) rule for the
  // shadow root, so each preview stage carries the attribute too. Token values
  // still inherit from body; this only reaches attribute-scoped rules.
  function applyTheme(dark) {
    document.body.toggleAttribute('data-ds-dark-theme', dark);
    var stages = document.querySelectorAll('.stage');
    for (var i = 0; i < stages.length; i++) stages[i].toggleAttribute('data-ds-dark-theme', dark);
  }
  // The choice outlives a page load, so the catalog keeps one palette while the
  // reader walks the five pages. The key is namespaced because GitHub Pages
  // serves every project of an account from one origin.
  var STORE_KEY = 'dsh-uiux-theme';
  function readStored() {
    try {
      var value = localStorage.getItem(STORE_KEY);
      return value === 'dark' ? true : value === 'light' ? false : null;
    } catch (err) { return null; }
  }
  function writeStored(dark) {
    try { localStorage.setItem(STORE_KEY, dark ? 'dark' : 'light'); } catch (err) {}
  }
  var toggle = document.querySelector('[data-theme-toggle]');
  // The button advertises the palette it switches to, which is also its label
  // for screen readers: the icons alone carry no text.
  function syncToggle(dark) {
    if (!toggle) return;
    var label = dark ? '切换到浅色主题' : '切换到深色主题';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }
  var dark = document.body.hasAttribute('data-ds-dark-theme');
  // A stored choice wins over the state the bootstrap script painted with; when
  // nothing is stored (or storage is unavailable) the document stands.
  var stored = readStored();
  if (stored !== null) dark = stored;
  applyTheme(dark);
  syncToggle(dark);
  if (toggle) toggle.addEventListener('click', function () {
    dark = !document.body.hasAttribute('data-ds-dark-theme');
    applyTheme(dark);
    syncToggle(dark);
    writeStored(dark);
  });
  apply();
})();
`

/**
 * Runs as the first child of `<body>`, before any content is parsed, so a
 * returning reader gets their palette on the very first paint instead of a
 * light flash. The catalog's own stylesheet keys off `body[data-ds-dark-theme]`,
 * which is the same attribute the ui-theme stylesheets use.
 */
const THEME_BOOTSTRAP = `
try { if (localStorage.getItem('dsh-uiux-theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', ''); } catch (err) {}
`

/**
 * The catalog outline: every page with its in-page sections as children. It is
 * built once and rendered identically into all five pages, so the rail keeps
 * its shape while the reader walks the catalog — only the highlighted branch
 * moves. Sections of the page being read link in-document; the rest carry the
 * file name so one click still lands on the right anchor.
 */
function railTree(active) {
  return SITE.map((node) => {
    const here = node.href === active
    const head = `<a class="home${here ? ' is-active' : ''}" href="${esc(node.href)}"${here ? ' aria-current="page"' : ''}>${esc(node.label)}${node.count ? `<span class="n">${esc(node.count)}</span>` : ''}</a>`
    if (node.sections.length === 0) return `    ${head}`
    const leaves = node.sections
      .map(
        (section) =>
          // Only the page being read can resolve an anchor, so only its leaves
          // carry the hook the scroll marker uses — ids like `g-settings` exist
          // on two pages, and the other page's copy must not match this one's.
          `<a class="leaf" href="${here ? '' : esc(node.href)}#${esc(section.id)}"${here ? ` data-section="${esc(section.id)}"` : ''}>${esc(section.label)}${section.count ? `<span class="n">${esc(section.count)}</span>` : ''}</a>`,
      )
      .join('\n      ')
    return `    ${head}
    <div class="leaves">
      ${leaves}
    </div>`
  }).join('\n')
}

/** Shared page shell. */
function page({ title, description, body, active }) {
  const nav = railTree(active)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="generator" content="tools/build.mjs">
<style>${themeCss()}</style>
<style>${fontCss()}</style>
<style>${CATALOG_CSS}</style>
</head>
<body data-catalog="${esc(active)}">
<script>${THEME_BOOTSTRAP}</script>
<div class="layout">
  <header class="masthead">
    <div>
      <div class="brandmark"><svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.2c-3.76 0-6.8 3.04-6.8 6.8s3.04 6.8 6.8 6.8 6.8-3.04 6.8-6.8S11.76 1.2 8 1.2Zm0 2.1a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z"/></svg><strong style="font:var(--dsw-font-s-strong-14)">DeepSeek Harness · UI/UX 组件目录</strong></div>
      <h1>${esc(title)}</h1>
      <p>${description}</p>
    </div>
    <div class="masthead-side">
      <div class="topbar">
        <a class="iconbtn" href="${REPO_URL}" target="_blank" rel="noreferrer" title="GitHub 仓库：${REPO_SLUG}" aria-label="GitHub 仓库：${REPO_SLUG}">${OCTOCAT}</a>
        <button class="iconbtn" type="button" data-theme-toggle aria-pressed="false" aria-label="切换浅色 / 深色主题" title="切换浅色 / 深色主题">${SUN}${MOON}</button>
      </div>
      <div class="meta">
        源码快照 ${esc(inventory?.sourceDate ?? 'unknown')}<br>
        扫描 ${esc(inventory?.scannedFiles ?? 0)} 个 .tsx · ${esc(inventory?.totals.packages ?? 0)} 个客户端包<br>
        ${esc((inventory?.generatedAt ?? '').slice(0, 19).replace('T', ' '))} UTC
      </div>
    </div>
  </header>
  <nav class="rail">
    <h2>目录</h2>
${nav}
  </nav>
  <main>
${body}
  </main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

/* ------------------------------------------------------------------- pages */

/** Home page: method, coverage, taxonomy, package breakdown. */
function indexPage() {
  const byKind = inventory.byKind
  const stat = (value, label) => `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`
  const packageRows = inventory.byPackage
    .map(
      (pkg) =>
        `<tr data-search="${esc(pkg.package.toLowerCase())}"><td class="mono">${esc(pkg.package.replace(/^packages\//, ''))}</td><td>${pkg.components}</td><td>${pkg.files}</td><td class="dim">${pkg.cssLines}</td></tr>`,
    )
    .join('')
  return page({
    title: '总览 · DeepSeek Harness UI 组件调研',
    description:
      '把 DeepSeek Harness Web 客户端的全部 React UI 组件按名称、导出变量、外观与代码来源整理成可检索的目录。外观示例不是截图，而是直接加载组件自身的 CSS Module 源码重绘。',
    active: 'index.html',
    body: `<section class="section" id="what">
  <h2>这份目录是什么</h2>
  <p class="lead">DeepSeek Harness 的 Web 界面由 <code>packages/client/</code> 下的 61 个客户端插件包组成，每个包通过插槽（Slot）把组件注册进界面。本目录扫描这些包的全部 <code>.tsx</code> 源码，抽取每个 React 组件的名称、导出变量名、代码位置、所属包、CSS Module 类名与它消费的 <code>--dsw-*</code> 设计变量，并为常用组件提供实时重绘的外观示例。</p>
  <div class="stats">
    ${stat(inventory.totals.components, 'React 组件')}
    ${stat(inventory.totals.packages, '客户端包')}
    ${stat(inventory.totals.distinctTokens, '被组件消费的设计变量')}
    ${stat(tokens?.totals.tokens ?? 0, '主题层设计变量')}
    ${stat(primitives.length, '已重绘 —— 基础组件')}
    ${stat(product.length, '已重绘 —— 产品组件')}
  </div>
  <div class="callout"><b>外观示例的生成方式。</b>每个示例把组件自己的 <code>*.module.css</code> 原文放进一个声明式 Shadow DOM（<code>&lt;template shadowrootmode&gt;</code>），并直接使用真实的 <code>--dsw-*</code> 变量。因此示例不是仿制图：点右上角的主题按钮即可让所有示例跟随浅色 / 深色变量一起变化，选择记在 <code>localStorage</code> 里，翻到别的页面也保持。条目列出多张样式表时，构建脚本按文件把类名改写成 <code>c&lt;下标&gt;-&lt;原名&gt;</code>，还原 CSS Module 在真实构建里的哈希隔离，避免 <code>.root</code> 这类同名类互相串味——细节见目录自带的 <code>README.md</code>。需要 JavaScript 才能产生的状态（悬停、菜单展开、弹窗、portal 定位）以静态快照配合状态附加样式呈现，并在示例标题旁标注。</div>
  <div class="callout"><b>覆盖范围。</b>清单页收录全部 ${inventory.totals.components} 个组件的元数据（名称、变量名、来源、设计变量、CSS 类名）。重绘页覆盖共 ${primitives.length + product.length} 个具代表性的组件：基础组件库的全部导出，加上产品层最常出现在用户视野里的组件。其余组件可在清单页按包与关键词定位到源码。</div>
</section>

<section class="section" id="layers">
  <h2>组件分层</h2>
  <p class="lead">按 <code>packages/client/AGENTS.md</code> 的层次约定划分：基础组件库是唯一可以跨功能包复用的组件来源，功能包不能互相导入组件，产品组件通过插槽组装成页面。</p>
  <div class="stats">
    ${stat(byKind.primitive ?? 0, 'primitive · ui-primitives 共享原子')}
    ${stat(byKind.icon ?? 0, 'icon · 图标与字形')}
    ${stat(byKind.product ?? 0, 'product · 功能包组件')}
    ${stat(byKind.artwork ?? 0, 'artwork · 品牌与插件美术')}
    ${stat((byKind.experimental ?? 0) + (byKind.extension ?? 0), 'experimental / extension')}
  </div>
</section>

<section class="section" id="conventions">
  <h2>界面约定</h2>
  <p class="lead">这些规则来自 <a href="${esc(sourceHref('docs/web-styling.md'))}" target="_blank" rel="noreferrer">docs/web-styling.md</a> 与 <code>packages/client/AGENTS.md</code>，是查阅这套组件时最容易判断错的地方。</p>
  <div class="cards">
    <article class="card"><header class="card-head"><div class="card-title"><h3>只用变量，不写字面值</h3><code class="var">--dsw-alias-*</code></div></header>
    <p class="summary">功能组件的 CSS 只消费语义别名，浅色 / 深色覆盖属于 ui-theme；不引入第二套主题，也不使用组件库或 Tailwind。自定义属性会穿过 Shadow DOM 边界，这正是本目录的示例能跟随主题切换的原因。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>0.5px 发丝线</h3><code class="var">--dsw-elevation-panel</code></div></header>
    <p class="summary">中性描边统一画成 0.5px（Chromium 渲染为一个设备像素）；浮层用 <code>border: 0</code> 加 <code>--dsw-elevation-*</code>，发丝描边是投影的第一层。把 <code>--dsw-alias-border-*</code> 与阴影层级叠在一起会被主题规格拒绝。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>菜单只有一种材质</h3><code class="var">MenuSurface</code></div></header>
    <p class="summary">下拉、右键、子菜单与选择列表都走 <code>Menu</code> 或 <code>MenuSurface</code>：半透明填充 <code>--dsw-menu-surface-fill</code> 与背景模糊由主题持有，功能包不得覆盖。唯一记录的例外是日程面板自有的 <code>TaskMenu</code> 与 <code>ClockPicker</code>。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>复用优先于新增</h3><code class="var">ui-primitives</code></div></header>
    <p class="summary">功能包之间不能互相导入组件，因此 <code>ui-primitives</code> 是唯一可以跨包复用的地方；已存在的控件不允许复制第二份，确有视觉差异时应提升为该组件的一个 prop。</p></article>
  </div>
</section>

<section class="section" id="reading">
  <h2>怎么读</h2>
  <p class="lead">四张子页分别对应四种查阅路径。</p>
  <div class="cards">
    <article class="card"><header class="card-head"><div class="card-title"><h3>基础组件库</h3><code class="var">ui-primitives</code></div><a class="src" href="${esc(sourceHref('packages/client/ui-primitives/README.md'))}" target="_blank" rel="noreferrer">packages/client/ui-primitives/README.md</a></header>
    <p class="summary">共享原子：按钮、开关、标签、菜单、弹窗、工具调用结果卡片、Markdown 渲染器、设置表单。写新组件前的第一站——已存在的控件不允许复制第二份。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>产品组件</h3><code class="var">packages/client/ui-*</code></div></header>
    <p class="summary">会话气泡、思考块、输入框、侧边栏、设置页、任务面板等由功能包拥有、通过插槽组合的组件。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>设计变量</h3><code class="var">--dsw-*</code></div><a class="src" href="${esc(sourceHref('packages/client/ui-theme/src/styles/design-platform.css'))}" target="_blank" rel="noreferrer">ui-theme/src/styles/design-platform.css</a></header>
    <p class="summary">主题层拥有的静态色板、语义别名、圆角、字体排印、浮层描边与投影。功能组件只消费语义别名，不写字面颜色。</p></article>
    <article class="card"><header class="card-head"><div class="card-title"><h3>全量清单</h3><code class="var">components.json</code></div></header>
    <p class="summary">全部 ${inventory.totals.components} 个组件的可检索表格，含导出变量名、源码位置、CSS 类名与设计变量，可直接定位到 <code>.tsx</code> 行号。</p></article>
  </div>
</section>

<section class="section" id="packages">
  <h2>包分布</h2>
  <p class="lead">按组件数量排序的全部 ${inventory.byPackage.length} 个客户端包，含图标与美术导出。</p>
  <div class="toolbar"><input type="search" data-filter placeholder="过滤包名…"><span class="count" data-count></span></div>
  <table class="grid packages"><colgroup><col class="c-pkg"><col><col><col></colgroup><thead><tr><th>包</th><th>组件</th><th>源文件</th><th>CSS 行数</th></tr></thead><tbody>
${packageRows}
  </tbody></table>
</section>

<section class="section" id="reproduce">
  <h2>复现方式</h2>
  <p class="lead">目录由仓库源码生成，不手工维护数字。</p>
  <div class="card"><div class="props" style="margin:0">
  <pre style="margin:0;font:var(--dsw-font-xxs-12);font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary);white-space:pre-wrap">cd &lt;目录&gt;                          # deepseek-harness 检出里的 UIUX/，或本仓库
node tools/extract.mjs              # 扫描 .tsx，产出 data/components.json
node tools/extract-tokens.mjs       # 解析 ui-theme 样式表，产出 data/tokens.json
node tools/build.mjs                # 组装 index / primitives / product / tokens / inventory</pre>
  </div></div>
</section>

<p class="footnote">数据源：<code>packages/client/**/src/**/*.tsx</code>、<code>packages/experimental/**</code>、<code>packages/extensions/**</code> 与 <code>packages/client/ui-theme/src/styles/*.css</code>。源码快照日期 ${esc(inventory.sourceDate)}。${SOURCE_BASE == null ? '源码链接使用相对路径，在 deepseek-harness 检出中打开有效。' : `源码链接指向 <a href="${esc(SOURCE_BASE.replace(/blob\/[^/]+\/$/, ''))}" target="_blank" rel="noreferrer">${esc(SOURCE_BASE.replace(/^https:\/\/github\.com\//, '').replace(/\/blob\//, ' @ ').replace(/\/$/, ''))}</a>，即生成这份目录时的上游版本。`}语言：中文说明 + 英文标识符（与源码一致）。</p>`,
  })
}

const TOKEN_GROUPS = ['static', 'alias', 'specific', 'radius', 'typography', 'elevation', 'shadow', 'gradient', 'material', 'focus', 'shape', 'host']

/** Sections of `tokens.html`, in the order the page lays them out. */
function tokenSections() {
  const groups = TOKEN_GROUPS.filter((key) => tokens.groups[key]).map((key) => ({
    id: `t-${key}`,
    label: tokens.groups[key].label,
    count: tokens.groups[key].count,
  }))
  return [...groups, { id: 't-upstream', label: '上游提供、本仓库未声明', count: undeclared.length }]
}

/**
 * Sections of a gallery page: the groups that actually hold entries, with the
 * entry count each. `galleryPage` renders them and the rail links to them.
 */
function gallerySections(groups, entries) {
  return groups
    .filter((group) => entries.some((entry) => (entry.group ?? 'other') === group.key))
    .map((group) => ({
      id: `g-${group.key}`,
      label: group.label,
      count: entries.filter((entry) => (entry.group ?? 'other') === group.key).length,
    }))
}

/** Sections of `index.html`, in reading order; the ids match its markup. */
const INDEX_SECTIONS = [
  { id: 'what', label: '这份目录是什么' },
  { id: 'layers', label: '组件分层' },
  { id: 'conventions', label: '界面约定' },
  { id: 'reading', label: '怎么读' },
  { id: 'packages', label: '包分布' },
  { id: 'reproduce', label: '复现方式' },
]

/** Curated gallery page for one entry collection. */
function galleryPage({ entries, title, description, file, groups, active }) {
  const groupDefs = groups ?? [...new Set(entries.map((entry) => entry.group ?? 'other'))].map((key) => ({ key, label: key }))
  const sections = groupDefs
    .map((group) => {
      const items = entries.filter((entry) => (entry.group ?? 'other') === group.key)
      if (items.length === 0) return ''
      return `<section class="section" id="g-${esc(group.key)}">
  <h2>${esc(group.label)} <span class="count">${items.length}</span></h2>
  ${group.description ? `<p class="lead">${esc(group.description)}</p>` : ''}
  <div class="cards">
${items.map(card).join('\n')}
  </div>
</section>`
    })
    .join('\n')
  return page({
    title,
    description,
    active,
    body: `<div class="toolbar">
  <input type="search" data-filter placeholder="按组件名、中文名或设计变量过滤…">
  <span class="count" data-count></span>
</div>
${sections}
<p class="footnote">共 ${entries.length} 个组件详情，数据来自 <code>data/${esc(file)}</code>。每个示例的样式表路径与源码行号写在卡片右上角。</p>`,
  })
}

/** Token reference page. */
function tokensPage() {
  const groupOrder = TOKEN_GROUPS
  const sections = groupOrder
    .filter((key) => tokens.groups[key])
    .map((key) => {
      const group = tokens.groups[key]
      if (key === 'typography') {
        const rows = group.tokens
          .filter((token) => !/-font-(family|weight|size|style)$/.test(token.name))
          .map(
            (token) =>
              `<div class="typerow"><div style="font:var(${token.name});color:var(--dsw-alias-label-primary)">深度思考 DeepSeek Harness · Aa 0123</div><code>${esc(token.name)}</code> <span class="val">${esc(token.light ?? '')}</span></div>`,
          )
          .join('')
        return `<section class="section" id="t-${key}"><h2>${esc(group.label)} <span class="count">${group.count}</span></h2><p class="lead">${esc(group.description)}</p>${rows}</section>`
      }
      if (key === 'elevation' || key === 'shadow') {
        const boxes = group.tokens
          .filter((token) => /panel|prominent|soft|lv1$|lv2$|lv3$/.test(token.name))
          .map((token) => `<div style="box-shadow:var(${token.name})"><code>${esc(token.name)}</code></div>`)
          .join('')
        return `<section class="section" id="t-${key}"><h2>${esc(group.label)} <span class="count">${group.count}</span></h2><p class="lead">${esc(group.description)}</p><div class="elev">${boxes}</div></section>`
      }
      const swatches = group.tokens
        .slice()
        .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
        .map((token) => {
          const chip =
            key === 'radius' || key === 'shape'
              ? `<div class="chip" style="background:var(--dsw-alias-bg-module-platform);display:flex;align-items:center;justify-content:center"><div style="width:64px;height:34px;background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(${token.name})"></div></div>`
              : token.dark
                ? `<div class="chip split"><div style="background:var(${token.name})"></div><div data-ds-dark-theme style="background:var(${token.name})"></div></div>`
                : `<div class="chip" style="background:var(${token.name})"></div>`
          return `<div class="swatch">${chip}<div class="meta"><code>${esc(token.name)}</code><div class="val">${esc(token.light ?? '')}</div>${token.usageCount ? `<div class="use">被 ${token.usageCount} 个组件引用</div>` : '<div class="use">未被组件直接引用</div>'}</div></div>`
        })
        .join('')
      return `<section class="section" id="t-${key}"><h2>${esc(group.label)} <span class="count">${group.count}</span></h2><p class="lead">${esc(group.description)}</p><div class="swatches">${swatches}</div></section>`
    })
    .join('')
  return page({
    title: '设计变量 · --dsw-*',
    description: `主题层在 <code>packages/client/ui-theme/src/styles/</code> 中声明的 ${tokens.totals.tokens} 个 CSS 自定义属性。功能组件只消费语义别名，浅色与深色各一套取值；色块直接读取真实变量，因此随主题切换。`,
    active: 'tokens.html',
    body: `<div class="callout"><b>命名约定。</b><code>--dsw-static-*</code> 是与主题无关的原始色阶；<code>--dsw-alias-*</code> 是按用途命名的语义别名，浅色与深色分别声明；<code>--dsw-specific-*</code> 是侧边栏、气泡、菜单等特定表面的填充；<code>--dsh-*</code> 是宿主层变量（字体栈、内容字号、滚动条）。<code>--dsw-font-*</code> 以 <code>字号 字重/行高 字族</code> 的简写形式整体消费。</div>
<div class="toolbar"><input type="search" data-filter placeholder="过滤变量名或取值…"><span class="count" data-count></span></div>
${sections}
<section class="section" id="t-upstream">
  <h2>上游提供、本仓库未声明 <span class="count">${undeclared.length}</span></h2>
  <p class="lead">组件 CSS 引用了这些变量，但 <code>packages/client/ui-theme/src/styles/</code> 里没有任何声明：它们由 Web 主题之下的上游平台主题提供（<code>base.css</code> 的注释记录了这层关系）。单独阅读组件源码时看不到取值，因此在这里列出。</p>
  ${undeclared.length === 0 ? '<p class="lead">当前没有这类变量。</p>' : `<table class="grid"><colgroup><col style="width:26%"><col><col style="width:26%"></colgroup><thead><tr><th>变量</th><th>引用它的组件</th><th>所在包</th></tr></thead><tbody>
${undeclared.map((item) => `<tr data-search="${esc(`${item.token} ${item.components.join(' ')}`)}"><td class="mono">${esc(item.token)}</td><td>${esc(item.components.join('、'))}</td><td class="dim mono">${esc([...item.packages].slice(0, 3).join(' '))}</td></tr>`).join('\n')}
  </tbody></table>`}
</section>
<p class="footnote">共 ${tokens.totals.tokens} 个变量，其中 ${tokens.totals.used} 个被组件 CSS 直接引用。左侧色块为浅色取值，深色列显示 <code>body[data-ds-dark-theme]</code> 覆盖。</p>`,
  })
}

/** Full inventory table. */
function inventoryPage() {
  const kinds = Object.entries(inventory.byKind)
  const packages = inventory.byPackage.map((pkg) => pkg.package).sort()
  const rows = inventory.components
    .map((component) => {
      const search = [component.name, component.package, component.file, component.propsType, ...(component.tokens ?? []), ...(component.cssClasses ?? [])]
        .join(' ')
        .toLowerCase()
      const curatedEntry = curatedIndex.get(`${component.package}::${component.name}`)
      const name = curatedEntry
        ? `<a href="${esc(curatedEntry.href)}" title="在图鉴中查看外观示例">${esc(component.name)}</a>`
        : `<code>${esc(component.name)}</code>`
      return `<tr data-search="${esc(search)}" data-kind="${esc(component.kind)}" data-pkg="${esc(component.package)}">
  <td>${name}${curatedEntry?.zh ? ` <span class="zh">${esc(curatedEntry.zh)}</span>` : ''}</td>
  <td class="dim"><span class="clamp">${esc(component.doc ? component.doc.split('\n')[0] : '')}</span></td>
  <td><span class="pill k-${esc(component.kind)}">${esc(component.kind)}</span></td>
  <td class="mono"><a href="${esc(sourceHref(component.file, component.line))}" target="_blank" rel="noreferrer">${esc(component.file.replace('packages/client/', '').replace('packages/', ''))}:${component.line}</a></td>
  <td class="mono dim">${esc(component.propsType ?? '—')}</td>
  <td class="mono dim">${esc((component.cssClasses ?? []).join(' ') || '—')}</td>
  <td class="dim">${(component.tokens ?? []).length || '—'}</td>
  <td>${component.publicExport ? '<span class="pill">公开</span>' : ''}</td>
</tr>`
    })
    .join('\n')
  const kindOptions = kinds.map(([kind, n]) => `<option value="${esc(kind)}">${esc(kind)} (${n})</option>`).join('')
  const pkgOptions = packages.map((pkg) => `<option value="${esc(pkg)}">${esc(pkg.replace(/^packages\//, ''))}</option>`).join('')
  return page({
    title: '全量组件清单',
    description: `扫描得到的 ${inventory.totals.components} 个 React 组件，逐个给出导出变量名、源码位置、Props 类型、CSS Module 类名与它消费的设计变量。可用名称、包、类型或变量名过滤。`,
    active: 'inventory.html',
    body: `<div class="toolbar">
  <input type="search" data-filter placeholder="过滤：组件名 / 包 / CSS 类 / 变量…">
  <select data-kind><option value="">全部类型</option>${kindOptions}</select>
  <select data-pkg><option value="">全部包</option>${pkgOptions}</select>
  <span class="count" data-count></span>
</div>
<table class="grid">
<colgroup><col class="c-name"><col class="c-doc"><col class="c-kind"><col class="c-src"><col class="c-props"><col class="c-css"><col class="c-tok"><col class="c-pub"></colgroup>
<thead><tr><th>组件变量名</th><th>说明（源码 JSDoc 首行）</th><th>类型</th><th>代码来源</th><th>Props</th><th>CSS 类</th><th>变量</th><th>导出</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<p class="footnote">类型判定：<code>primitive</code> 为 <code>ui-primitives</code> 的共享原子，<code>icon</code> / <code>artwork</code> 为字形与美术，<code>product</code> 为功能包组件，<code>experimental</code> / <code>extension</code> 为实验与扩展包。点击来源路径可直接打开对应源码行。</p>`,
  })
}

/* --------------------------------------------------------------------- run */

/**
 * Tokens component CSS consumes but no stylesheet in this repository declares.
 * The Web theme layers on an upstream platform theme, so these stay resolvable
 * in the product; listing them keeps the boundary visible to anyone reading a
 * component's CSS in isolation.
 */
function undeclaredTokens() {
  const declared = new Set((tokens?.tokens ?? []).map((token) => token.name))
  const usage = new Map()
  for (const component of inventory.components) {
    for (const token of component.tokens ?? []) {
      if (declared.has(token)) continue
      if (!usage.has(token)) usage.set(token, { token, components: [], packages: new Set() })
      const entry = usage.get(token)
      if (entry.components.length < 8) entry.components.push(component.name)
      entry.packages.add(component.package.replace(/^packages\//, ''))
    }
  }
  return [...usage.values()].sort((a, b) => a.token.localeCompare(b.token))
}

const undeclared = undeclaredTokens()

const PRIMITIVE_GROUPS = [
  { key: 'controls', label: '控制 Controls', description: '按钮、开关、复选框、分段选择等直接接受输入的原语。' },
  { key: 'display', label: '展示 Display', description: '标签、胶囊、路径、状态点、JSON 树等只读展示原语。' },
  { key: 'input', label: '输入 Input', description: '单行输入、行内编辑器与配置字段。' },
  { key: 'overlay', label: '浮层 Overlay', description: '菜单、弹窗、提示气泡、悬浮卡片与图片灯箱。' },
  { key: 'output', label: 'Agent 输出渲染 Agent output', description: '工具调用结果卡片、Markdown、代码块与终端输出。' },
  { key: 'settings', label: '设置表单 Settings', description: '插件设置页的表单骨架与字段控件。' },
  { key: 'brand', label: '品牌与图标 Brand & icons', description: '品牌字标、权限图标、文件类型图标与插件美术。' },
]

const PRODUCT_GROUPS = [
  { key: 'conversation', label: '会话流 Conversation', description: '消息气泡、思考块、工具行、回合操作等对话主体。' },
  { key: 'shell', label: '外壳与布局 Shell', description: '应用框架、侧边栏、右侧面板与停靠区。' },
  { key: 'settings', label: '设置页 Settings', description: '设置页骨架、分组与各行控件。' },
  { key: 'panels', label: '功能面板 Panels', description: '任务计划、目标、交付物、插件市场、工作区等功能页。' },
  { key: 'overlays', label: '浮层与对话 Overlays', description: '对话框、确认框、选择菜单与消息反馈。' },
  { key: 'agent', label: 'Agent 运行视图 Runtime', description: '轨迹、子代理、工作流、后台任务等运行时视图。' },
]

/**
 * The outline every page's rail renders: one node per page, its in-page
 * sections underneath. Built before the pages so the tree a reader navigates
 * by is the same on all five of them.
 */
const SITE = [
  { href: 'index.html', label: '总览', count: '', sections: INDEX_SECTIONS },
  { href: 'primitives.html', label: '基础组件库', count: String(primitives.length), sections: gallerySections(PRIMITIVE_GROUPS, primitives) },
  { href: 'product.html', label: '产品组件', count: String(product.length), sections: gallerySections(PRODUCT_GROUPS, product) },
  { href: 'tokens.html', label: '设计变量', count: tokens ? String(tokens.totals.tokens) : '', sections: tokens ? tokenSections() : [] },
  { href: 'inventory.html', label: '全量清单', count: inventory ? String(inventory.totals.components) : '', sections: [] },
]

const pages = [
  ['index.html', indexPage()],
  [
    'primitives.html',
    galleryPage({
      entries: primitives,
      title: '基础组件库 · ui-primitives',
      description: `跨功能包唯一可复用的组件来源，共 ${inventory.components.filter((c) => c.package === 'packages/client/ui-primitives').length} 个导出（含图标与美术）。每个组件不依赖 Cordis 与插槽系统，只通过 <code>--dsw-*</code> 变量着色，因此任何插件都能安全组合。下面 ${primitives.length} 个条目给出实时重绘、Props 与设计变量。`,
      file: 'data/parts/*.json',
      groups: PRIMITIVE_GROUPS,
      active: 'primitives.html',
    }),
  ],
  [
    'product.html',
    galleryPage({
      entries: product,
      title: '产品组件 · 功能包',
      description: `由 <code>packages/client/ui-*</code> 各功能包拥有、通过插槽组装成页面的组件，共 ${inventory.components.filter((c) => ['product', 'experimental', 'extension'].includes(c.kind)).length} 个。下面 ${product.length} 个条目是用户视野中最常出现的部分。`,
      file: 'data/parts/*.json',
      groups: PRODUCT_GROUPS,
      active: 'product.html',
    }),
  ],
  ['tokens.html', tokensPage()],
  ['inventory.html', inventoryPage()],
]

let bytes = 0
for (const [name, html] of pages) {
  writeFileSync(join(OUT, name), html)
  bytes += Buffer.byteLength(html)
}

const missing = missingGlyphs(pages)
if (missing.length > 0) {
  mkdirSync(DATA, { recursive: true })
  const known = existsSync(join(DATA, 'cjk-charset.txt')) ? readFileSync(join(DATA, 'cjk-charset.txt'), 'utf8') : ''
  writeFileSync(join(DATA, 'cjk-charset.txt'), [...new Set([...known, ...missing])].sort().join(''))
  console.log(
    `CJK font subset covers ${missing.length} character(s) the pages newly need — run ` +
      `"node tools/font.mjs" and rebuild (see README.md).`,
  )
}
console.log(
  `wrote ${pages.length} pages, ${(bytes / 1024).toFixed(0)} KiB; primitives=${primitives.length} ` +
    `product=${product.length} curated; embedded font: ${fontCss() ? 'yes' : 'no'}`,
)
