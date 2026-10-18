#!/usr/bin/env node
/**
 * Subsets a CJK font down to the characters the catalog actually uses and
 * writes `UIUX/assets/cjk-<weight>.woff2`.
 *
 * The catalog is written in Chinese, and the machines that render the product's
 * default font stack (`PingFang SC` / `Microsoft YaHei`) do not necessarily
 * have a CJK face installed at all. Embedding a subset keeps the pages readable
 * offline and self-contained: a few hundred glyphs cost ~100 KB per weight
 * instead of the ~8 MB source font.
 *
 * `build.mjs` writes `data/cjk-charset.txt` whenever the rendered pages need
 * characters the current subset does not cover; run this script, then rebuild.
 *
 * Usage:
 *   node tools/font.mjs [--tools <dir>] [--cache <dir>] [--weights 400,500]
 *
 * `--tools` names a directory holding an installed `subset-font` package
 * (it is a build-time-only tool and deliberately not a repository dependency):
 *   mkdir -p /tmp/dsh-uiux-font && cd /tmp/dsh-uiux-font
 *   npm install --cache ./.npm-cache subset-font
 *   node tools/font.mjs --tools /tmp/dsh-uiux-font
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Catalog directory (this script lives in its `tools/`). */
const CATALOG = join(HERE, '..')
const DATA = join(CATALOG, 'data')
const ASSETS = join(CATALOG, 'assets')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const TOOLS = flag('tools', process.env.UIUX_FONT_TOOLS ?? '/tmp/fontwork')
const CACHE = flag('cache', join(TOOLS, 'cache'))
const WEIGHTS = flag('weights', '400,500').split(',')

/** Source faces; the SubsetOTF build ships one file per weight. */
const SOURCES = {
  400: {
    file: 'NotoSansSC-Regular.otf',
    url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  },
  500: {
    file: 'NotoSansSC-Medium.otf',
    url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Medium.otf',
  },
}

/** Every character the catalog may render: the charset file plus ASCII. */
function charset() {
  const path = join(DATA, 'cjk-charset.txt')
  if (!existsSync(path)) {
    throw new Error(`${path} is missing — run "node tools/build.mjs" first; it reports the characters it needs.`)
  }
  const text = readFileSync(path, 'utf8')
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
  return [...new Set([...text, ...ascii])].join('')
}

/** Downloads a source face when the cache does not have it yet. */
async function sourceFont(weight) {
  const source = SOURCES[weight]
  if (!source) throw new Error(`no source face configured for weight ${weight}`)
  const path = join(CACHE, source.file)
  if (existsSync(path)) return readFileSync(path)
  mkdirSync(CACHE, { recursive: true })
  process.stderr.write(`downloading ${source.url}\n`)
  const response = await fetch(source.url)
  if (!response.ok) throw new Error(`download failed: ${response.status} ${source.url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(path, buffer)
  return buffer
}

async function main() {
  const subsetFontPath = join(TOOLS, 'node_modules', 'subset-font', 'index.js')
  if (!existsSync(subsetFontPath)) {
    throw new Error(`subset-font not found at ${subsetFontPath}; install it there or pass --tools <dir>`)
  }
  const { default: subsetFont } = await import(pathToFileURL(subsetFontPath).href)
  const text = charset()
  mkdirSync(ASSETS, { recursive: true })
  for (const weight of WEIGHTS) {
    const font = await sourceFont(weight)
    const out = await subsetFont(font, text, { targetFormat: 'woff2' })
    const path = join(ASSETS, `cjk-${weight}.woff2`)
    writeFileSync(path, out)
    console.log(`cjk-${weight}.woff2  ${(out.length / 1024).toFixed(0)} KiB  ${[...text].length} glyphs requested`)
  }
  const written = readdirSync(ASSETS)
  console.log(`assets: ${written.join(', ')} — now re-run node tools/build.mjs`)
}

await main()
