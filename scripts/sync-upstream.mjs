#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runPm } from './pm.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const UPSTREAM_URL = 'https://github.com/bowenliang123/dsh-context'
const UPSTREAM_REF = process.env.SYNC_UPSTREAM_REF ?? 'upstream/main'

const REMOVED_FILES = [
  'data/recoms.json',
  'src/client/components/pluginInfo.tsx',
  'src/client/components/recomCard.tsx',
  'src/client/styles/recom.css',
  'src/host/recoms.ts',
  'src/shared/recoms.ts',
  'tests/client/components/pluginInfo.spec.ts',
  'tests/client/components/recomCard.spec.ts',
  'tests/host/recoms.spec.ts',
  'tests/shared/recoms.spec.ts',
]

const CONTEXT_VIEW_REMOVALS = new Set([
  "import { makeRecomCard } from './recomCard'",
  "import { makePluginInfo } from './pluginInfo'",
  'const RecomCard = makeRecomCard(kit, ctx)',
  'const PluginInfo = makePluginInfo(kit, ctx)',
  '<RecomCard />',
  '<PluginInfo />',
])

const I18N_REMOVAL = /^\s*'(recom\.title|plugin\.(title|hint|name|github))':/

const LINE_RULES = new Map([
  ['src/client/components/contextView.tsx', line => CONTEXT_VIEW_REMOVALS.has(line.trim())],
  ['src/client/i18nEn.ts', line => I18N_REMOVAL.test(line)],
  ['src/client/i18nZh.ts', line => I18N_REMOVAL.test(line)],
  ['src/host/index.ts', line => /^\s*import \{ watchRecomChannel \} from '\.\/recoms'\s*$/.test(line) || /^\s*watchRecomChannel\(ctx\)\s*$/.test(line)],
  ['src/client/index.ts', line => /^\s*import '\.\/styles\/recom\.css'\s*$/.test(line)],
  ['src/client/apiRoutes.ts', line => /^\s*export const RECOM_ROUTE = /.test(line)],
  ['src/client/styles/stats.css', line => /^\.lc-pi-[^{]*\{/.test(line)],
  ['tests/client/components/contextView.projectionGuards.spec.ts', line => line.includes('.lc-recom') || line.includes('.lc-pi-grid')],
])

const BASE_HEAD_BLOCK = /\.lc-head \{ container: lc-head \/ inline-size; \}\r?\n\.lc-head > \.lc-col \{[^\n]*\}\r?\n@container lc-head \(min-width: 640px\) \{\r?\n[^\n]*\r?\n\}\r?\n/

const FORBIDDEN = /lc-recom|lc-pi-|makeRecomCard|makePluginInfo|watchRecomChannel|RECOM_ROUTE|recom\.title|plugin\.(title|hint|name|github)'/

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

function fail(message) {
  console.error('sync-upstream: ' + message)
  process.exit(1)
}

function ensureUpstream() {
  const remotes = git(['remote'])
  if (!remotes.split(/\r?\n/).includes('upstream')) {
    git(['remote', 'add', 'upstream', UPSTREAM_URL])
    console.log('sync-upstream: added the upstream remote')
  }
}

function stripText(file, text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const rule = LINE_RULES.get(file)
  let next = text
  if (rule !== undefined) {
    next = next.split(/\r?\n/).filter(line => !rule(line)).join(eol)
  }
  if (file.endsWith('contextView.tsx')) {
    next = next.replace(/\r?\n[ \t]*<div className="lc-col">\r?\n[ \t]*<\/div>/, '')
  }
  if (file.endsWith('base.css')) {
    next = next.replace(BASE_HEAD_BLOCK, '')
  }
  if (file.endsWith('tsdown.config.ts')) {
    next = next.replace(/,\s*'simple-icons'/, '')
  }
  return next.replace(/\r?\n{3,}/g, eol + eol)
}

function stripWorktree() {
  for (const file of REMOVED_FILES) {
    if (existsSync(resolve(ROOT, file))) git(['rm', '-q', '-f', '--', file])
  }
  for (const file of LINE_RULES.keys()) {
    const path = resolve(ROOT, file)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    const after = stripText(file, before)
    if (after !== before) writeFileSync(path, after)
  }
  const tsdown = resolve(ROOT, 'tsdown.config.ts')
  if (existsSync(tsdown)) {
    const before = readFileSync(tsdown, 'utf8')
    const after = stripText('tsdown.config.ts', before)
    if (after !== before) writeFileSync(tsdown, after)
  }
}

function verify() {
  const files = git(['ls-files', 'src', 'tests', 'data']).split(/\r?\n/).filter(Boolean)
  const hits = []
  for (const file of files) {
    const path = resolve(ROOT, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    if (FORBIDDEN.test(text)) hits.push(file)
  }
  if (hits.length > 0) {
    fail('the following files still reference the removed cards, resolve them by hand:\n  ' + hits.join('\n  '))
  }
}

function inMerge() {
  try {
    git(['rev-parse', '--verify', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

function unmergedFiles() {
  return git(['diff', '--name-only', '--diff-filter=U']).split(/\r?\n/).filter(Boolean)
}

function abortMerge(reason) {
  try {
    git(['merge', '--abort'])
  } catch {
  }
  fail(reason + ', the merge was aborted')
}

function resolveConflicts() {
  const unmerged = unmergedFiles()
  if (unmerged.length === 0) return
  const known = unmerged.filter(file => REMOVED_FILES.includes(file) || LINE_RULES.has(file) || file.endsWith('base.css') || file.endsWith('tsdown.config.ts'))
  const unknown = unmerged.filter(file => !known.includes(file))
  if (unknown.length > 0) abortMerge('conflicts outside the known removed cards, resolve them by hand:\n  ' + unknown.join('\n  '))
  for (const file of known) {
    if (REMOVED_FILES.includes(file)) {
      git(['rm', '-q', '-f', '--', file])
      continue
    }
    git(['checkout', '--theirs', '--', file])
    const path = resolve(ROOT, file)
    writeFileSync(path, stripText(file, readFileSync(path, 'utf8')))
    git(['add', '--', file])
  }
  console.log('sync-upstream: resolved ' + known.length + ' conflict(s) by keeping the removal')
}

function installIfNeeded() {
  const staged = git(['diff', '--cached', '--name-only'])
  if (!/^(package\.json|pnpm-lock\.yaml)$/m.test(staged)) return
  console.log('sync-upstream: dependencies changed upstream, installing them')
  if (runPm(['install', '--frozen-lockfile', '--ignore-scripts']) !== 0) abortMerge('the dependency install failed')
}

function runGate() {
  for (const script of ['lint', 'typecheck', 'coverage']) {
    if (runPm(['run', script]) !== 0) abortMerge('the ' + script + ' gate failed')
  }
}

function finishMerge() {
  resolveConflicts()
  stripWorktree()
  verify()
  git(['add', '-A'])
  installIfNeeded()
  git(['add', '-A'])
  runGate()
  git(['commit', '-q', '--no-edit', '--no-verify'])
  console.log('sync-upstream: merged ' + UPSTREAM_REF + ' into ' + git(['log', '--oneline', '-1']))
}

const args = new Set(process.argv.slice(2))
const status = git(['status', '--porcelain'])
if (inMerge()) {
  console.log('sync-upstream: finishing a pending merge from an earlier run')
  finishMerge()
} else if (status !== '') {
  fail('the worktree is dirty, commit or stash first')
}

ensureUpstream()
git(['fetch', '-q', 'origin', 'main'])
git(['fetch', '-q', 'upstream', 'main'])

const beforeOrigin = git(['rev-parse', 'HEAD'])
try {
  git(['merge', '--ff-only', 'origin/main'])
} catch {
  console.log('sync-upstream: local main has unpublished commits, not fast-forwarding from origin/main')
}
if (git(['rev-parse', 'HEAD']) !== beforeOrigin) console.log('sync-upstream: fast-forwarded to origin/main')

const ancestor = (() => {
  try {
    git(['merge-base', '--is-ancestor', UPSTREAM_REF, 'HEAD'])
    return true
  } catch {
    return false
  }
})()

if (ancestor) {
  console.log('sync-upstream: already up to date with ' + UPSTREAM_REF)
  process.exit(0)
}

let merged = true
try {
  git(['merge', '--no-commit', '--no-ff', UPSTREAM_REF])
} catch {
  merged = false
}
if (!merged && unmergedFiles().length === 0) abortMerge('the merge failed without conflicts')
finishMerge()

if (args.has('--push')) {
  git(['push', 'origin', 'main'])
  console.log('sync-upstream: pushed to origin/main')
}
