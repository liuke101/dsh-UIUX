#!/usr/bin/env node
/**
 * One-shot verification of the UIUX catalog: entry schema and class/token
 * resolution, the repository's prohibited-reference rule, and page totals.
 *
 * Usage: node tools/check.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const UIUX = join(HERE, '..')
/** Nearest ancestor holding the documented sources, for the reference scan. */
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
const ROOT = findCheckout(UIUX) ?? join(UIUX, '..')

const run = (label, args) => {
  process.stdout.write(`\n== ${label}\n`)
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
    process.stdout.write(out)
    return true
  } catch (error) {
    process.stdout.write(error.stdout ?? '')
    process.stderr.write(error.stderr ?? '')
    return false
  }
}

/**
 * The repository rejects commit identifiers in maintained files, and UIUX is
 * untracked-but-scanned. This mirrors scripts/verify-repository-references.ts
 * for the files this directory owns.
 */
function referenceCheck() {
  process.stdout.write('\n== 仓库引用规则（scripts/verify-repository-references.ts 的等价检查）\n')
  const candidate = /(?<![a-z0-9])[\da-f]{7,40}(?![a-z0-9])/gi
  const organizationUrl = /\bgithub\.com\/deepseek-harness(?![a-z0-9-])/
  let commits = new Set()
  try {
    commits = new Set(
      execFileSync('git', ['rev-list', '--all', '--abbrev-commit', '--abbrev=10'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim().toLowerCase()),
    )
  } catch {
    process.stdout.write('  无法读取提交列表，跳过提交号检查\n')
  }
  const findings = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
        continue
      }
      if (!/\.(html|json|mjs|md|txt)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      text.split('\n').forEach((line, index) => {
        if (organizationUrl.test(line)) findings.push(`${full}:${index + 1} 组织 URL`)
        for (const match of line.matchAll(candidate)) {
          if (commits.has(match[0].toLowerCase())) findings.push(`${full}:${index + 1} 提交号 ${match[0]}`)
        }
      })
    }
  }
  walk(UIUX)
  process.stdout.write(findings.length === 0 ? '  ok — 没有禁止的引用\n' : `${findings.map((line) => `  - ${line}`).join('\n')}\n`)
  return findings.length === 0
}

/** Page inventory: size and the counts each page should carry. */
function pageTotals() {
  process.stdout.write('\n== 页面产物\n')
  const files = readdirSync(UIUX).filter((name) => name.endsWith('.html')).sort()
  let bytes = 0
  for (const name of files) {
    const size = statSync(join(UIUX, name)).size
    bytes += size
    const html = readFileSync(join(UIUX, name), 'utf8')
    const stages = (html.match(/<template shadowrootmode="open">/g) ?? []).length
    const cards = (html.match(/<article class="card" id=/g) ?? []).length
    process.stdout.write(`  ${name.padEnd(16)} ${(size / 1024).toFixed(0).padStart(5)} KiB  cards=${String(cards).padStart(3)}  previews=${stages}\n`)
  }
  process.stdout.write(`  ${'total'.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(5)} KiB\n`)
  const font = join(UIUX, 'assets', 'cjk-400.woff2')
  process.stdout.write(`  中文字体子集: ${existsSync(font) ? `${(statSync(font).size / 1024).toFixed(0)} KiB + ${(statSync(join(UIUX, 'assets', 'cjk-500.woff2')).size / 1024).toFixed(0)} KiB 已内嵌` : '缺失 — 运行 tools/font.mjs'}\n`)
  return files.length > 0
}

const ok = [
  run('条目校验（tools/validate.mjs）', [join(HERE, 'validate.mjs')]),
  referenceCheck(),
  pageTotals(),
].every(Boolean)

process.stdout.write(ok ? '\ncheck: ok\n' : '\ncheck: 存在问题\n')
if (!ok) process.exitCode = 1
