import type { EngineInterface } from 'claude-code'

import type { Sticker } from '../types'
import { joinPath } from './pack'

/** Which picker window this machine opens. */
export type Host = 'windows' | 'macos' | 'linux'

/** How long the picker may stay open before it is closed for you. */
const PICKER_TIMEOUT_MS = 5 * 60 * 1000

/** The command that opens the picker window on `host`, from the plugin's folder. */
export function pickerArgv(host: Host, root: string): string[] {
  const dir = joinPath(root, 'picker')
  if (host === 'windows') {
    // -STA: WinForms needs a single-threaded apartment.
    const script = joinPath(dir, 'picker.ps1')
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script]
  }
  if (host === 'macos') return ['osascript', '-l', 'JavaScript', joinPath(dir, 'picker-macos.js')]
  return ['python3', joinPath(dir, 'picker.py')]
}

export async function detectHost($: EngineInterface): Promise<Host> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  try {
    const { stdout } = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    return stdout.trim() === 'Darwin' ? 'macos' : 'linux'
  } catch {
    return 'linux'
  }
}

export type Picked = { sticker?: Sticker; error?: string }

/**
 * Opens the floating picker window with every sticker that has a PNG and
 * resolves the one clicked, nothing when it was closed, or why it could not
 * open.
 */
export async function openPicker($: EngineInterface, host: Host, stickers: readonly Sticker[]): Promise<Picked> {
  const shown = stickers.filter(s => s.file !== undefined)
  if (shown.length === 0) return { error: 'no sticker has a picture file' }
  const input = JSON.stringify(shown.map(s => ({ name: s.name, description: s.description, file: s.file })))

  let result
  try {
    result = await $.process.run(pickerArgv(host, $.plugin.root), { stdin: input, timeoutMs: PICKER_TIMEOUT_MS })
  } catch (error) {
    return { error: `the picker window could not run: ${String(error)}` }
  }
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().split('\n').pop() ?? `exit code ${result.exitCode}`
    const hint = host === 'linux' ? ' (it needs python3 with Tk: install python3-tk)' : ''
    return { error: `the picker window failed${hint}: ${reason}` }
  }
  const name = result.stdout.trim()
  return name === '' ? {} : { sticker: stickers.find(s => s.name === name) }
}
