#!/usr/bin/env node
/**
 * Extracts the DeepSeek Harness client UI component inventory.
 *
 * Reads React component exports from `.tsx` sources under the browser client
 * packages, together with each source's CSS Module class names and the
 * `--dsw-*` design tokens those classes consume. Writes `data/components.json`.
 *
 * Usage: node tools/extract.mjs [--root <repoRoot>]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--root')

/** Catalog directory (this script lives in its `tools/`). */
const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(CATALOG, 'data')

/** Nearest ancestor holding the packages this catalog documents. */
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
if (!existsSync(join(ROOT, 'packages/client'))) {
  console.error(
    `extract: no deepseek-harness checkout above ${CATALOG}. ` +
      'Run this script from <checkout>/UIUX/tools/ or pass --root <checkout>.',
  )
  process.exit(1)
}

/** Source roots scanned for browser-side React components. */
const SOURCE_ROOTS = [
  'packages/client',
  'packages/experimental',
  'packages/extensions',
]

/** Directories never holding product UI components. */
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', 'tests', '__snapshots__', '.git'])

/** @returns {string[]} every `.tsx` file below `dir`, excluding skipped directories. */
function walk(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(full))
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      found.push(full)
    }
  }
  return found
}

/** Extracts the CSS Module class names and `--dsw-*` tokens a stylesheet uses. */
function readCssModule(cssPath) {
  let text
  try {
    text = readFileSync(cssPath, 'utf8')
  } catch {
    return null
  }
  const classes = new Set()
  for (const match of text.matchAll(/^\.(-?[_a-zA-Z][\w-]*)/gm)) classes.add(match[1])
  const tokens = new Set()
  for (const match of text.matchAll(/var\(\s*(--dsw-[\w-]+)/g)) tokens.add(match[1])
  const keyframes = new Set()
  for (const match of text.matchAll(/@keyframes\s+([\w-]+)/g)) keyframes.add(match[1])
  return {
    file: cssPath,
    lines: text.split('\n').length,
    text,
    classes: [...classes].sort(),
    tokens: [...tokens].sort(),
    keyframes: [...keyframes].sort(),
  }
}

const JSX_RE = /<[A-Za-z][\w.:-]*[\s/>]|<>/
const COMPONENT_FACTORY_RE = /\b(?:forwardRef|memo)\s*[(<]/

/** Leading JSDoc block directly above `lines[index]`, or null. */
function leadingDoc(lines, index) {
  let end = index - 1
  while (end >= 0 && lines[end].trim() === '') end -= 1
  if (end < 0 || !lines[end].trimEnd().endsWith('*/')) return null
  let start = end
  while (start >= 0 && !lines[start].trimStart().startsWith('/*')) start -= 1
  if (start < 0) return null
  const block = lines.slice(start, end + 1).join('\n')
  const text = block
    .replace(/^\s*\/\*\*?/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*̥?\s?/, '').trimEnd())
    .join('\n')
    .trim()
  return { text, line: start + 1 }
}

/** Text of a `function` body: lines up to the closing brace in column 0. */
function functionBody(lines, startIndex) {
  const out = [lines[startIndex]]
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    out.push(lines[i])
    if (lines[i] === '}') break
    if (out.length > 400) break
  }
  return out.join('\n')
}

/** Text of a `const NAME = ...` initializer: lines up to the next top-level declaration. */
function constInitializer(lines, startIndex) {
  const out = [lines[startIndex]]
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^(export |const |function |type |interface |declare |\/\*\*|})/.test(line)) break
    out.push(line)
    if (out.length > 120) break
  }
  return out.join('\n')
}

const EXPORT_FN_RE = /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/
const EXPORT_CONST_RE = /^export\s+(?:default\s+)?const\s+([A-Za-z_$][\w$]*)/
const EXPORT_CLASS_RE = /^export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/

/** Parses one `.tsx` source into component and hook records. */
function parseSource(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const components = []
  const hooks = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    let name = null
    let body = null
    let form = null
    const fn = EXPORT_FN_RE.exec(line)
    const cnst = EXPORT_CONST_RE.exec(line)
    const cls = EXPORT_CLASS_RE.exec(line)
    if (fn) {
      name = fn[1]
      body = functionBody(lines, i)
      form = line.includes('export default') ? 'default function' : 'function'
    } else if (cnst) {
      name = cnst[1]
      body = constInitializer(lines, i)
      form = line.includes('export default') ? 'default const' : 'const'
    } else if (cls) {
      name = cls[1]
      body = functionBody(lines, i)
      form = 'class'
    }
    if (name == null || body == null) continue
    const head = body.slice(0, 4000)
    const looksLikeComponent = JSX_RE.test(head) || COMPONENT_FACTORY_RE.test(head)
    const record = {
      name,
      line: i + 1,
      form,
      file: relative(ROOT, file),
      doc: leadingDoc(lines, i),
      propsType: null,
      jsx: JSX_RE.test(head),
      factory: COMPONENT_FACTORY_RE.test(head),
    }
    const generic = /forwardRef<\s*[\w<>,\s[\]]*?,\s*([A-Za-z_$][\w$]*)\s*>/.exec(head)
    const paramType = /\(\s*\{?[^)]*?\}?\s*:\s*([A-Za-z_$][\w$]*)/.exec(head)
    record.propsType = generic?.[1] ?? paramType?.[1] ?? null
    if (!looksLikeComponent) continue
    if (/^use[A-Z]/.test(name)) hooks.push(record)
    else if (/^[A-Z]/.test(name)) components.push(record)
  }
  return { components, hooks }
}

/** Public export names of a package index, mapped to their source specifier. */
function parseIndexExports(indexFile) {
  let text
  try {
    text = readFileSync(indexFile, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const match of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean)
    for (const name of names) out.push({ name, from: match[2], public: true })
  }
  for (const match of text.matchAll(/^export\s+\*\s+from\s*'([^']+)'/gm)) {
    out.push({ name: '*', from: match[1], public: true })
  }
  return out
}

/** Package name for a repo-relative source file. */
function packageOf(relFile) {
  const parts = relFile.split('/')
  const idx = parts.indexOf('src')
  return idx > 0 ? parts.slice(0, idx).join('/') : parts.slice(0, 2).join('/')
}

/** Coarse classification of a component record. */
function classify(relFile, name, pkg) {
  if (/\/icons\//.test(relFile) || /^Icon[A-Z]/.test(name) || /Icon(Regular|Medium)$/.test(name)) return 'icon'
  if (/Artwork/.test(name) || /^(FishLogo|BrandWordmark|SiteGlyph|CodeFileIcon)$/.test(name)) return 'artwork'
  if (pkg === 'packages/client/ui-primitives') return 'primitive'
  if (pkg.startsWith('packages/experimental')) return 'experimental'
  if (pkg.startsWith('packages/extensions')) return 'extension'
  return 'product'
}

function main() {
  const files = SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root))).sort()
  const components = []
  const hooks = []
  const byPackage = new Map()
  for (const file of files) {
    const rel = relative(ROOT, file)
    const pkg = packageOf(rel)
    const css = readCssModule(join(dirname(file), `${basename(file, '.tsx')}.module.css`))
    const parsed = parseSource(file)
    if (!byPackage.has(pkg)) byPackage.set(pkg, { package: pkg, files: 0, components: 0, cssLines: 0 })
    const bucket = byPackage.get(pkg)
    bucket.files += 1
    bucket.cssLines += css?.lines ?? 0
    for (const record of parsed.components) {
      bucket.components += 1
      components.push({
        id: `${pkg.replace(/^packages\//, '')}/${record.name}`,
        name: record.name,
        exportName: record.name,
        kind: classify(rel, record.name, pkg),
        package: pkg,
        file: rel,
        line: record.line,
        form: record.form,
        propsType: record.propsType,
        doc: record.doc?.text ?? null,
        docLine: record.doc?.line ?? null,
        cssModule: css ? relative(ROOT, css.file) : null,
        cssClasses: css?.classes ?? [],
        cssKeyframes: css?.keyframes ?? [],
        tokens: css?.tokens ?? [],
      })
    }
    for (const record of parsed.hooks) {
      hooks.push({ name: record.name, package: pkg, file: rel, line: record.line, doc: record.doc?.text ?? null })
    }
  }

  // Public export surface, per package index.
  const publicExports = new Map()
  for (const pkg of byPackage.keys()) {
    const indexFile = join(ROOT, pkg, 'src', 'index.ts')
    for (const entry of parseIndexExports(indexFile)) {
      const key = entry.name
      publicExports.set(`${pkg}::${key}`, entry)
    }
  }
  for (const component of components) {
    const direct = publicExports.get(`${component.package}::${component.exportName}`)
    const star = publicExports.get(`${component.package}::*`)
    component.publicExport = Boolean(direct || star)
    component.exportedFrom = direct?.from ?? star?.from ?? null
  }

  const countBy = (key) => {
    const acc = {}
    for (const item of components) acc[item[key]] = (acc[item[key]] ?? 0) + 1
    return Object.fromEntries(Object.entries(acc).sort((a, b) => b[1] - a[1]))
  }

  let sourceDate = 'unknown'
  try {
    sourceDate = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format:%Y-%m-%d'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    /* repository metadata is optional for the catalog */
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    // The repository rejects commit identifiers in maintained files, so the
    // catalog records the revision date instead of a hash.
    sourceDate,
    scannedFiles: files.length,
    totals: {
      components: components.length,
      hooks: hooks.length,
      cssModules: components.filter((c) => c.cssModule != null).length,
      packages: byPackage.size,
      distinctTokens: new Set(components.flatMap((c) => c.tokens)).size,
    },
    byKind: countBy('kind'),
    byPackage: [...byPackage.values()].sort((a, b) => b.components - a.components),
    components,
    hooks,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'components.json'), `${JSON.stringify(payload, null, 1)}\n`)
  console.log(
    `components=${components.length} hooks=${hooks.length} files=${files.length} packages=${byPackage.size} ` +
      `kinds=${JSON.stringify(payload.byKind)}`,
  )
}

main()
