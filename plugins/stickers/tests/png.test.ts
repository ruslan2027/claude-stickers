import { describe, expect, test } from 'claude-code/testing'

import { decodePng, fromBase64, inflate, toBase64, toCells } from '../hooks/png'

// 3 x 2 pictures written by PIL, with the RGBA it reads them back as.
const FIXTURES: Array<[string, string, number[]]> = [
  ['rgba', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAHklEQVR4nGP4z8Dwn+E/QwOIYuASkft/IsXoPwgAAH9YDBFrY3SnAAAAAElFTkSuQmCC', [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255, 200, 100, 50, 255, 255, 255, 255, 255]],
  ['rgb', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAGElEQVR4nGP4z8DAAMFcInInUoz+//8PADwZB5XvwsbYAAAAAElFTkSuQmCC', [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 200, 100, 50, 255, 255, 255, 255, 255]],
  ['gray', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAEElEQVR4nGPwmSbLdOzZIwALOQOQ/bwxagAAAABJRU5ErkJggg==', [76, 76, 76, 255, 150, 150, 150, 255, 29, 29, 29, 255, 18, 18, 18, 255, 124, 124, 124, 255, 255, 255, 255, 255]],
  ['palette with transparency', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACBAMAAABvWnspAAAAGFBMVEX////IZDL/AAAA/wAKFB4AAP8AAAAAAABu5FKBAAAAAXRSTlMAQObYZgAAAA5JREFUeJxjVNZlcGQAAAHxAJO9jPolAAAAAElFTkSuQmCC', [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 200, 100, 50, 255, 255, 255, 255, 0]],
]

describe('decodePng', () => {
  for (const [name, png, rgba] of FIXTURES) {
    test(`decodes ${name}`, () => {
      const pic = decodePng(fromBase64(png))
      expect([pic.width, pic.height]).toEqual([3, 2])
      expect(Array.from(pic.rgba)).toEqual(rgba)
    })
  }

  test('refuses what is not a PNG', () => {
    expect(() => decodePng(fromBase64('bm90IGEgcG5n'))).toThrow('not a PNG')
  })
})

test('inflate reads stored blocks', () => {
  // One final stored block holding "hi".
  expect(Array.from(inflate(Uint8Array.of(1, 2, 0, 253, 255, 104, 105)))).toEqual([104, 105])
})

test('base64 round-trips every length', () => {
  for (let n = 0; n < 10; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 255)
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
  }
  expect(toBase64(Uint8Array.of(104, 105))).toBe('aGk=')
})

describe('toCells', () => {
  const words = (cells: string) => {
    const b = fromBase64(cells)
    return Array.from(new Uint32Array(b.buffer, b.byteOffset, b.length / 4))
  }
  const DEFAULT = 0x01000000

  test('paints two pixels a cell with half blocks', () => {
    // 1 x 2: red over blue.
    const pic = { width: 1, height: 2, rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255) }
    expect(words(toCells(pic, 1, 1))).toEqual([0x2580, 0xff0000, 0x0000ff])
  })

  test('leaves transparent pixels to the terminal background', () => {
    const top = { width: 1, height: 2, rgba: Uint8Array.of(0, 0, 0, 0, 0, 255, 0, 255) }
    expect(words(toCells(top, 1, 1))).toEqual([0x2584, 0x00ff00, DEFAULT])
    const none = { width: 1, height: 2, rgba: new Uint8Array(8) }
    expect(words(toCells(none, 1, 1))).toEqual([0x20, DEFAULT, DEFAULT])
  })

  test('averages a larger picture down to the grid', () => {
    // 2 x 2, all one color, into a single cell.
    const pic = { width: 2, height: 2, rgba: new Uint8Array(16).fill(255).map((v, i) => (i % 4 === 1 ? 0 : v)) }
    expect(words(toCells(pic, 1, 1))).toEqual([0x2580, 0xff00ff, 0xff00ff])
  })
})
