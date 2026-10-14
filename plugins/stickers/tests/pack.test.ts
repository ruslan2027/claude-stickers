import { describe, expect, test } from 'claude-code/testing'

import type { Sticker } from '../types'
import {
  findSticker,
  formatSticker,
  joinPath,
  parseManifest,
  promptSection,
  splitStickers,
  stickerOfMessage,
} from '../hooks/pack'

const STICKERS: Sticker[] = [
  { name: 'happy', description: 'a smiling yellow face', emotion: 'happy' },
  { name: 'sad', description: 'a blue face with a single tear', emotion: 'sad' },
]

describe('parseManifest', () => {
  test('reads a stickers list and fills in file names', () => {
    const { entries, problems } = parseManifest(
      JSON.stringify({ stickers: [{ name: 'Happy', description: 'a smile', emotion: 'happy' }] }),
    )
    expect(problems).toEqual([])
    expect(entries).toEqual([
      { name: 'happy', description: 'a smile', emotion: 'happy', file: 'happy.png', svg: 'happy.svg' },
    ])
  })

  test('takes a bare array and custom file names', () => {
    const { entries } = parseManifest(JSON.stringify([{ name: 'x', description: 'an x', file: 'pics/x.png' }]))
    expect(entries[0]?.file).toBe('pics/x.png')
    expect(entries[0]?.emotion).toBe('')
  })

  test('skips bad entries and says why', () => {
    const { entries, problems } = parseManifest(
      JSON.stringify({
        stickers: [
          { name: 'ok', description: 'fine' },
          { name: 'bad name!', description: 'x' },
          { name: 'nodesc' },
          { name: 'ok', description: 'again' },
          { name: 'br', description: 'has ] in it' },
        ],
      }),
    )
    expect(entries.map(e => e.name)).toEqual(['ok'])
    expect(problems).toHaveLength(4)
  })

  test('reports invalid JSON', () => {
    const { entries, problems } = parseManifest('{nope')
    expect(entries).toEqual([])
    expect(problems[0]).toContain('not valid JSON')
  })
})

describe('messages', () => {
  test('formats a sticker as the person sends it', () => {
    expect(formatSticker(STICKERS[0]!)).toBe('[sticker: a smiling yellow face]')
  })

  test('recognises a sent sticker by its description', () => {
    expect(stickerOfMessage('[sticker: a blue face with a single tear]', STICKERS)?.name).toBe('sad')
    expect(stickerOfMessage('[sticker: something else]', STICKERS)).toBeUndefined()
    expect(stickerOfMessage('hello [sticker: a smiling yellow face]', STICKERS)).toBeUndefined()
  })

  test('finds stickers by name, case, token or number', () => {
    expect(findSticker(STICKERS, 'SAD')?.name).toBe('sad')
    expect(findSticker(STICKERS, ':sticker:happy:')?.name).toBe('happy')
    expect(findSticker(STICKERS, '2')?.name).toBe('sad')
    expect(findSticker(STICKERS, '9')).toBeUndefined()
    expect(findSticker(STICKERS, 'nope')).toBeUndefined()
  })
})

describe('splitStickers', () => {
  test('cuts a reply around known sticker tokens', () => {
    expect(splitStickers('Done!\n:sticker:happy:\nAll tests pass.', STICKERS)).toEqual([
      { kind: 'text', text: 'Done!' },
      { kind: 'sticker', sticker: STICKERS[0] },
      { kind: 'text', text: 'All tests pass.' },
    ])
  })

  test('leaves unknown names and code alone', () => {
    const text = 'Use `:sticker:happy:` like so:\n```\n:sticker:sad:\n```\n:sticker:unknown:'
    expect(splitStickers(text, STICKERS)).toEqual([{ kind: 'text', text }])
  })

  test('matches names in any case', () => {
    expect(splitStickers(':sticker:SAD:', STICKERS)).toEqual([{ kind: 'sticker', sticker: STICKERS[1] }])
  })
})

test('joinPath keeps the folder separator', () => {
  expect(joinPath('/a/b/', 'c.png')).toBe('/a/b/c.png')
  expect(joinPath('C:\\packs\\mine', 'c.png')).toBe('C:\\packs\\mine\\c.png')
  expect(joinPath('/a', '/abs/c.png')).toBe('/abs/c.png')
})

test('the prompt section lists every sticker', () => {
  const text = promptSection(STICKERS)
  expect(text).toContain(':sticker:<name>:')
  expect(text).toContain('- sad: a blue face with a single tear (sad)')
})
