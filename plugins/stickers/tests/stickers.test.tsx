import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunResult, PromptSubmitInput } from 'claude-code'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'

const MANIFEST = JSON.stringify({
  stickers: [
    { name: 'happy', description: 'a smiling yellow face', emotion: 'happy' },
    { name: 'sad', description: 'a blue face with a single tear', emotion: 'sad' },
    { name: 'plain', description: 'a sticker with no SVG', emotion: 'neutral' },
  ],
})

/** The files the plugin may read, by the path's ending. */
const FILES: Record<string, string | { base64: string }> = {
  'stickers.json': MANIFEST,
  'happy.png': { base64: PNG },
  'happy.svg': SVG,
  'sad.png': { base64: PNG },
  'sad.svg': SVG,
  'plain.png': { base64: PNG },
}

/** The environment of a plain terminal (Windows Terminal, Terminal.app, xterm). */
const PLAIN_TERMINAL: Record<string, string> = { HOME: '/home/me', TERM: 'xterm-256color' }
const KITTY: Record<string, string> = { HOME: '/home/me', TERM: 'xterm-kitty' }

const SURFACES = ['terminal', 'desktop'] as const

type Run = { argv: readonly string[]; stdin?: string }
type Seen = { submitted: PromptSubmitInput[]; filled: string[]; read: string[]; toasts: string[]; runs: Run[] }
type Setup = {
  files?: typeof FILES
  env?: Record<string, string>
  /** What the picker window answers; `uname -s` answers `uname`. */
  picker?: Partial<ProcessRunResult>
  uname?: string
}

/** Stands in for the engine beneath the plugin, then starts the session. */
async function start($: Engine, on: On, setup: Setup = {}): Promise<Seen> {
  const { files = FILES, env = PLAIN_TERMINAL, picker = {}, uname = 'Linux' } = setup
  const seen: Seen = { submitted: [], filled: [], read: [], toasts: [], runs: [] }
  on('fs.read', async (_$, e) => {
    const path = e.path.replace(/\\/g, '/')
    seen.read.push(path)
    const hit = Object.keys(files).find(name => path.endsWith(`/${name}`))
    if (hit === undefined) return { deny: `ENOENT: ${path}` }
    return { value: files[hit]! }
  })
  on('fs.stat', async (_$, e) => ({
    value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path },
  }))
  on('env.get', async (_$, e) => ({ value: env[e.name] }))
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const isUname = e.argv[0] === 'uname'
    return {
      value: {
        exitCode: 0,
        stdout: isUname ? `${uname}\n` : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
        ...(isUname ? {} : picker),
      },
    }
  })
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => {
    seen.submitted.push(e)
    return { text: e.text, origin: e.origin }
  })
  on('prompt.fill', async (_$, e) => {
    seen.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.compose', async () => ({ sections: [] }))
  // What the engine draws where the plugin draws nothing of its own.
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return seen
}

function band(surface: (typeof SURFACES)[number], maxRows = 12) {
  return {
    plugin: 'stickers',
    surface,
    component: 'AbovePrompt' as const,
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: maxRows - 1 },
      view: {},
    },
  }
}

function command($: Engine, args: string) {
  return $.command.run({
    command: 'sticker',
    args,
    origin: { kind: 'plugin', name: 'test' },
    presentation: { isFullscreen: false, columns: 100 },
  } as never)
}

const SAD = '[sticker: a blue face with a single tear]'

// --- the palette ------------------------------------------------------------

test('the palette has one button per sticker, numbered 1-9, and 0 opens the picker', async ($, on) => {
  await start($, on)
  const terminal = await $.ui.mount(band('terminal'))
  const buttons = await terminal.findAll({ type: 'Button' })
  expect(buttons.map(b => b.key)).toEqual(['send-happy', 'send-sad', 'send-plain', 'open-picker'])
  expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '0'])
  await terminal.unmount()

  // The desktop draws the pictures itself, so it has no picker button.
  const desktop = await $.ui.mount(band('desktop'))
  expect((await desktop.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['send-happy', 'send-sad', 'send-plain'])
})

test('a plain terminal shows names, not alt text or pixels', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(0)
})

test('the desktop shows each sticker as its Svg', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('desktop'))
  // "plain" has no SVG, so the desktop shows its button alone.
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
})

test('kitty gets sharp Images', async ($, on) => {
  await start($, on, { env: KITTY })
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
})

test('Ghostty is recognised by TERM_PROGRAM', async ($, on) => {
  await start($, on, { env: { TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' } })
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
})

test('inside tmux even kitty gets names', async ($, on) => {
  await start($, on, { env: { ...KITTY, TMUX: '/tmp/tmux-1000/default,1,0' } })
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
})

test('the pictures setting overrides detection', { options: { pictures: 'image' } }, async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
})

test('cells draws each sticker as half-block cells', { options: { pictures: 'cells' } }, async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('terminal'))
  const rasters = await ui.findAll({ type: 'Raster' })
  expect(rasters).toHaveLength(3)
  // 10 x 5 cells of three little-endian u32 words each, base64.
  expect(rasters[0]?.props).toMatchObject({ columns: 10, rows: 5 })
  expect(String(rasters[0]?.props.cells)).toHaveLength(Math.ceil((10 * 5 * 12) / 3) * 4)
})

test('a short band drops the previews and keeps the buttons', { options: { pictures: 'image' } }, async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('terminal', 3))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
})

test('a file that is no PNG costs only its own picture, and says why', { options: { pictures: 'image' } }, async ($, on) => {
  const seen = await start($, on, { files: { ...FILES, 'sad.png': { base64: 'bm90IGEgcG5n' } } })
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  expect(seen.toasts[0]).toContain('sad.png is not a PNG')
})

test('pressing a sticker submits it as the person', async ($, on) => {
  const seen = await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    await ui.press({ key: 'send-sad' })
    await ui.unmount()
  }
  expect(seen.submitted.map(e => e.text)).toEqual([SAD, SAD])
  expect(seen.submitted[0]?.origin).toMatchObject({ kind: 'plugin', name: 'stickers', asUser: true })
})

// --- the picker window --------------------------------------------------------

test('the picker opens with every sticker picture and sends the one clicked', async ($, on) => {
  const seen = await start($, on, { picker: { stdout: 'sad' } })
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'open-picker' })

  const picker = seen.runs.find(r => r.argv[0] !== 'uname')
  expect(picker?.argv.slice(0, 1)).toEqual(['python3'])
  expect(picker?.argv[1]).toMatch(/picker[\\/]picker\.py$/)
  const items = JSON.parse(picker?.stdin ?? '[]') as Array<{ name: string; file: string }>
  expect(items.map(i => i.name)).toEqual(['happy', 'sad', 'plain'])
  expect(items[1]?.file).toMatch(/pack[\\/]sad\.png$/)
  expect(seen.submitted.map(e => e.text)).toEqual([SAD])
})

test('the picker is PowerShell on Windows', async ($, on) => {
  const windows = await start($, on, { env: { ...PLAIN_TERMINAL, OS: 'Windows_NT' } })
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'open-picker' })
  expect(windows.runs.map(r => r.argv[0])).toEqual(['powershell.exe'])
  expect(windows.runs[0]?.argv).toContain('-STA')
  expect(windows.runs[0]?.argv.at(-1)).toMatch(/picker[\\/]picker\.ps1$/)
})

test('macOS is told apart by uname', async ($, on) => {
  const seen = await start($, on, { uname: 'Darwin' })
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'open-picker' })
  const picker = seen.runs.find(r => r.argv[0] !== 'uname')
  expect(picker?.argv.slice(0, 3)).toEqual(['osascript', '-l', 'JavaScript'])
  expect(picker?.argv[3]).toMatch(/picker[\\/]picker-macos\.js$/)
})

test('closing the picker sends nothing', async ($, on) => {
  const seen = await start($, on, { picker: { stdout: '' } })
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'open-picker' })
  expect(seen.submitted).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('a picker that fails says why', async ($, on) => {
  const seen = await start($, on, { picker: { exitCode: 1, stderr: "ModuleNotFoundError: No module named 'tkinter'" } })
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'open-picker' })
  expect(seen.submitted).toEqual([])
  expect(seen.toasts[0]).toContain('python3-tk')
  expect(seen.toasts[0]).toContain('tkinter')
})

// --- /sticker -----------------------------------------------------------------

test('/sticker <name> fills the prompt and runs no turn', async ($, on) => {
  const seen = await start($, on)
  const result = await command($, 'Happy')
  expect(seen.filled).toEqual(['[sticker: a smiling yellow face]'])
  expect(seen.submitted).toEqual([])
  expect(result.text).toContain('press Enter')
})

test('/sticker alone opens the picker and fills the prompt with the pick', async ($, on) => {
  const seen = await start($, on, { picker: { stdout: 'sad\n' } })
  const result = await command($, '')
  expect(seen.filled).toEqual([SAD])
  expect(seen.submitted).toEqual([])
  expect(result.text).toContain('"sad"')
})

test('/sticker list lists the stickers; an unknown name says so', async ($, on) => {
  const seen = await start($, on)
  expect((await command($, 'list')).text).toContain('2  sad')
  expect((await command($, 'nope')).text).toContain('No sticker "nope"')
  expect(seen.filled).toEqual([])
})

// --- the transcript -------------------------------------------------------------

test('a reply naming a sticker draws it in place of the token', async ($, on) => {
  await start($, on, { env: KITTY })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'stickers',
      surface,
      component: 'AssistantMessage',
      props: { text: 'All green!\n:sticker:happy:\nShipping it.', isFirstOfReply: true },
    })
    const texts = await ui.findAll({ type: 'Markdown' })
    expect(texts.map(t => t.text)).toEqual(['All green!', 'Shipping it.'])
    expect(await ui.findAll({ type: surface === 'terminal' ? 'Image' : 'Svg' })).toHaveLength(1)
    await ui.unmount()
  }
})

test('in a plain terminal a reply sticker is a label naming it', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({
    plugin: 'stickers',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: ':sticker:happy:', isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('[sticker: a smiling yellow face]')
})

test('a sticker with no picture for the surface falls back to a label', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({
    plugin: 'stickers',
    surface: 'desktop',
    component: 'AssistantMessage',
    props: { text: ':sticker:plain:', isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('[sticker: a sticker with no SVG]')
})

test('a sent sticker is drawn as its picture in the transcript', async ($, on) => {
  await start($, on, { env: KITTY })
  const ui = await $.ui.mount({
    plugin: 'stickers',
    surface: 'terminal',
    component: 'UserMessage',
    props: {
      text: '[sticker: a smiling yellow face]',
      origin: { kind: 'plugin', name: 'stickers', asUser: true },
      isExpanded: false,
    },
  })
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ columns: 24, rows: 12 })
})

// --- the pack -------------------------------------------------------------------

test('a custom pack folder is read in place of the built-in one', { options: { packDir: '~/my-pack' } }, async ($, on) => {
  const seen = await start($, on)
  expect(seen.read[0]).toMatch(/\/home\/me\/my-pack\/stickers\.json$/)
})

test('a missing pack shows a toast and no palette', async ($, on) => {
  const seen = await start($, on, { files: {} })
  expect(seen.toasts[0]).toContain('cannot read')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('Claude is told which stickers it may send', async ($, on) => {
  await start($, on)
  const result = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(result.sections.map(s => s.id)).toEqual(['stickers:palette'])
  expect(result.sections[0]?.text).toContain('- happy: a smiling yellow face')
})
