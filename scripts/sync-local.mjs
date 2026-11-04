#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ARTIFACTS = ['lib/client.js', 'lib/index.js', 'lib/index.d.ts']
const FORBIDDEN = /lc-recom|lc-pi-|makeRecomCard|makePluginInfo|watchRecomChannel|RECOM_ROUTE|recom\.title/

function fail(message) {
  console.error('sync-local: ' + message)
  process.exit(1)
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function packageName(dir) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).name ?? null
  } catch {
    return null
  }
}

function installedCandidates() {
  const profiles = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles')
  if (!existsSync(profiles)) return []
  return readdirSync(profiles)
    .map(profile => join(profiles, profile, 'node_modules', 'dsh-context'))
    .filter(dir => existsSync(dir) && packageName(dir) === 'dsh-context')
}

for (const artifact of ARTIFACTS) {
  if (!existsSync(join(ROOT, artifact))) fail('missing ' + artifact + ', run the build first')
}

const explicit = argValue('--target') ?? process.env.DSH_CONTEXT_TARGET
const candidates = installedCandidates()
const target = explicit ?? (candidates.length === 1 ? candidates[0] : null)
if (target === null) {
  fail(candidates.length === 0
    ? 'no installed dsh-context found, pass --target <dir>'
    : 'several installed dsh-context copies found, pass --target <dir>:\n  ' + candidates.join('\n  '))
}
if (!existsSync(join(target, 'package.json'))) fail('not a dsh-context package: ' + target)
if (packageName(target) !== 'dsh-context') fail('not a dsh-context package: ' + target)

for (const artifact of ARTIFACTS) {
  const source = join(ROOT, artifact)
  if (FORBIDDEN.test(readFileSync(source, 'utf8'))) fail('the build still references the removed cards: ' + artifact)
  copyFileSync(source, join(target, artifact))
}

const localeSource = join(ROOT, 'locale')
const localeTarget = join(target, 'locale')
if (existsSync(localeSource) && existsSync(localeTarget)) {
  for (const file of readdirSync(localeSource)) {
    if (file.endsWith('.json')) copyFileSync(join(localeSource, file), join(localeTarget, file))
  }
}

for (const artifact of ARTIFACTS) {
  if (FORBIDDEN.test(readFileSync(join(target, artifact), 'utf8'))) fail('the installed copy still references the removed cards: ' + artifact)
}

console.log('sync-local: synced into ' + target)
console.log('sync-local: restart DeepSeek Harness to load the new bundle')
