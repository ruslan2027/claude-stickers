import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptSubmitInput } from 'claude-code'

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

const SURFACES = ['terminal', 'desktop'] as const

type Seen = { submitted: PromptSubmitInput[]; filled: string[]; read: string[]; toasts: string[] }

/** Stands in for the engine beneath the plugin, then starts the session. */
async function start($: Engine, on: On, files = FILES): Promise<Seen> {
  const seen: Seen = { submitted: [], filled: [], read: [], toasts: [] }
  on('fs.read', async (_$, e) => {
    const path = e.path.replace(/\\/g, '/')
    seen.read.push(path)
    const hit = Object.keys(files).find(name => path.endsWith(`/${name}`))
    if (hit === undefined) return { deny: `ENOENT: ${path}` }
    return { value: files[hit]! }
  })
  on('env.get', async () => ({ value: '/home/me' }))
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

test('the palette has one button per sticker, numbered 1-9', async ($, on) => {
  await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.key)).toEqual(['send-happy', 'send-sad', 'send-plain'])
    expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3'])
    await ui.unmount()
  }
})

test('previews are Images on the terminal and Svg on the desktop', async ($, on) => {
  await start($, on)

  const terminal = await $.ui.mount(band('terminal'))
  expect(await terminal.findAll({ type: 'Image' })).toHaveLength(3)
  await terminal.unmount()

  const desktop = await $.ui.mount(band('desktop'))
  expect(await desktop.findAll({ type: 'Image' })).toHaveLength(0)
  // "plain" has no SVG, so the desktop shows its button alone.
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(2)
  await desktop.unmount()
})

test('a short band drops the previews and keeps the buttons', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(band('terminal', 3))
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
})

test('pressing a sticker submits it as the person', async ($, on) => {
  const seen = await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    await ui.press({ key: 'send-sad' })
    await ui.unmount()
  }
  expect(seen.submitted.map(e => e.text)).toEqual([
    '[sticker: a blue face with a single tear]',
    '[sticker: a blue face with a single tear]',
  ])
})

test('/sticker <name> fills the prompt and runs no turn', async ($, on) => {
  const seen = await start($, on)
  const result = await $.command.run({
    command: 'sticker',
    args: 'Happy',
    origin: { kind: 'plugin', name: 'test' },
    presentation: { isFullscreen: false, columns: 100 },
  } as never)
  expect(seen.filled).toEqual(['[sticker: a smiling yellow face]'])
  expect(seen.submitted).toEqual([])
  expect(result.text).toContain('press Enter')
})

test('/sticker with no name lists the stickers; an unknown name says so', async ($, on) => {
  const seen = await start($, on)
  const run = (args: string) =>
    $.command.run({
      command: 'sticker',
      args,
      origin: { kind: 'plugin', name: 'test' },
      presentation: { isFullscreen: false, columns: 100 },
    } as never)
  expect((await run('')).text).toContain('2  sad')
  expect((await run('nope')).text).toContain('No sticker "nope"')
  expect(seen.filled).toEqual([])
})

test('a reply naming a sticker draws the sticker in place of the token', async ($, on) => {
  await start($, on)
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
  await start($, on)
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
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
})

test('a custom pack folder is read in place of the built-in one', { options: { packDir: '~/my-pack' } }, async ($, on) => {
  const seen = await start($, on)
  expect(seen.read[0]).toMatch(/\/home\/me\/my-pack\/stickers\.json$/)
})

test('a missing pack shows a toast and no palette', async ($, on) => {
  const seen = await start($, on, {})
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
