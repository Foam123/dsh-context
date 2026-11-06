import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..')

if (process.env.HOME === undefined && process.env.USERPROFILE !== undefined) {
  process.env.HOME = process.env.USERPROFILE
}

function invocation() {
  const execPath = process.env.npm_execpath
  if (execPath === undefined) return { command: 'corepack', prefix: ['pnpm'], shell: true }
  if (/\.(?:c|m)?js$/i.test(execPath)) return { command: process.execPath, prefix: [execPath], shell: false }
  return { command: execPath, prefix: [], shell: /\.(?:cmd|bat)$/i.test(execPath) }
}

export function runPm(args, options = {}) {
  const { command, prefix, shell } = invocation()
  return spawnSync(command, [...prefix, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell,
    env: { ...process.env, ...options.env },
  }).status
}
