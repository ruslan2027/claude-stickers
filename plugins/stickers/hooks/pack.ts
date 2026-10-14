import type { Sticker } from '../types'

/** One entry of stickers.json, before its files are read. */
export type Entry = {
  name: string
  description: string
  emotion: string
  file: string
  svg: string
}

const NAME = /^[a-z0-9_-]{1,32}$/

/** The text a sticker is sent as, in the person's own message. */
export function formatSticker(sticker: Pick<Sticker, 'description'>): string {
  return `[sticker: ${sticker.description}]`
}

/** The sticker a sent message stands for, when it is exactly one sticker. */
export function stickerOfMessage(text: string, stickers: readonly Sticker[]): Sticker | undefined {
  const match = /^\[sticker: (.+)\]$/.exec(text.trim())
  return match ? stickers.find(s => s.description === match[1]) : undefined
}

/**
 * Reads stickers.json: `{ "stickers": [...] }` or a bare array of
 * `{ name, description, emotion, file?, svg? }`. Bad entries are skipped and
 * named in `problems`.
 */
export function parseManifest(text: string): { entries: Entry[]; problems: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { entries: [], problems: [`stickers.json is not valid JSON: ${String(error)}`] }
  }
  const list = Array.isArray(data)
    ? data
    : data !== null && typeof data === 'object' && Array.isArray((data as { stickers?: unknown }).stickers)
      ? ((data as { stickers: unknown[] }).stickers)
      : undefined
  if (list === undefined) {
    return { entries: [], problems: ['stickers.json has no "stickers" list'] }
  }

  const entries: Entry[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  list.forEach((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : ''
    if (!NAME.test(name)) {
      problems.push(`sticker ${i + 1}: "name" must be 1-32 letters, digits, _ or -`)
      return
    }
    if (seen.has(name)) {
      problems.push(`sticker "${name}" is listed twice`)
      return
    }
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    if (description === '' || description.includes(']') || description.includes('\n')) {
      problems.push(`sticker "${name}": "description" must be one line of text without "]"`)
      return
    }
    seen.add(name)
    entries.push({
      name,
      description,
      emotion: typeof item.emotion === 'string' ? item.emotion.trim() : '',
      file: typeof item.file === 'string' && item.file !== '' ? item.file : `${name}.png`,
      svg: typeof item.svg === 'string' && item.svg !== '' ? item.svg : `${name}.svg`,
    })
  })
  return { entries, problems }
}

/** Finds a sticker by name (any case) or by its palette number, 1 to 9. */
export function findSticker(stickers: readonly Sticker[], query: string): Sticker | undefined {
  const q = query.trim().toLowerCase().replace(/^:sticker:|:$/g, '')
  if (/^[1-9]$/.test(q)) return stickers[Number(q) - 1]
  return stickers.find(s => s.name === q)
}

export type Segment = { kind: 'text'; text: string } | { kind: 'sticker'; sticker: Sticker }

/**
 * Splits a reply's text around `:sticker:<name>:` tokens that name a known
 * sticker. Tokens inside code (fenced or inline) and unknown names stay text.
 */
export function splitStickers(text: string, stickers: readonly Sticker[]): Segment[] {
  const byName = new Map(stickers.map(s => [s.name, s]))
  const pattern = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)|:sticker:([a-z0-9_-]+):/gi
  const out: Segment[] = []
  const pushText = (part: string) => {
    if (part.trim() !== '') out.push({ kind: 'text', text: part.trim() })
  }
  let last = 0
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const sticker = m[2] === undefined ? undefined : byName.get(m[2].toLowerCase())
    if (sticker === undefined) continue
    pushText(text.slice(last, m.index))
    out.push({ kind: 'sticker', sticker })
    last = m.index + m[0].length
  }
  pushText(text.slice(last))
  return out
}

/** Joins a folder and a file name, keeping the folder's own separator. */
export function joinPath(dir: string, file: string): string {
  if (/^([a-z]:)?[\\/]/i.test(file)) return file
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + file
}

/** The system prompt section that lets Claude send stickers. */
export function promptSection(stickers: readonly Sticker[]): string {
  const lines = stickers.map(s => `- ${s.name}: ${s.description}${s.emotion ? ` (${s.emotion})` : ''}`)
  return [
    '# Stickers',
    'The user has a sticker palette. A message of theirs that reads "[sticker: <description>]" is a sticker they sent you; take it as the feeling it shows.',
    'You may send one back, sparingly and only where it fits the mood, by writing :sticker:<name>: on its own line in a reply; it is drawn as the picture. Available stickers:',
    ...lines,
  ].join('\n')
}
