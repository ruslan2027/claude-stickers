import { atom, read, update } from 'claude-code'
import type { EngineInterface, Elements, RenderElement, RenderSurface, Register } from 'claude-code'

import type { Pack, Pictures, Sticker } from '../types'
import {
  findSticker,
  formatSticker,
  joinPath,
  parseManifest,
  promptSection,
  splitStickers,
  stickerOfMessage,
} from './pack'
import { detectHost, openPicker } from './picker'
import { decodePng, fromBase64, toCells } from './png'

const pack = atom({ plugin: 'stickers', key: 'pack' } as const, null)

/** PNGs past this are left to the text label (an Image takes 2 MiB at most). */
const MAX_PNG_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)
const MAX_SVG = 131_072
/** The first bytes of every PNG file (89 50 4E 47 0D 0A 1A 0A), base64. */
const PNG_SIGNATURE = 'iVBORw0KGgo'

/** Terminal cells a sticker takes: in the palette, and in the transcript. */
const SMALL = { columns: 10, rows: 5 }
const BIG = { columns: 24, rows: 12 }

/**
 * How the terminal draws stickers. `Image` needs the kitty graphics protocol
 * (kitty, Ghostty) and shows only its alt text elsewhere, so `auto` takes it
 * only where the terminal says it is one of those, and never inside tmux,
 * which drops it. Elsewhere the band shows names, and the picker window shows
 * the pictures. `cells` draws colored half-block cells, which every terminal
 * can show, if coarse.
 */
async function terminalPictures($: EngineInterface, setting: unknown): Promise<Pictures> {
  if (setting === 'image' || setting === 'cells' || setting === 'labels') return setting
  if ((await $.env.get('TMUX')) !== undefined) return 'labels'
  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  const isKitty = (await $.env.get('KITTY_WINDOW_ID')) !== undefined || term.includes('kitty')
  const isGhostty = term.includes('ghostty') || program.toLowerCase() === 'ghostty'
  return isKitty || isGhostty ? 'image' : 'labels'
}

/** The folder as an absolute path, for the picker window, which runs elsewhere. */
async function absolute($: EngineInterface, dir: string): Promise<string> {
  try {
    return (await $.fs.stat(dir, { resolve: true })).realPath ?? dir
  } catch {
    return dir
  }
}

/** The sticker's PNG as half-block cells at both sizes, for a Raster. */
function cellsOf(base64: string): Sticker['cells'] {
  const pic = decodePng(fromBase64(base64))
  return {
    small: toCells(pic, SMALL.columns, SMALL.rows),
    big: toCells(pic, BIG.columns, BIG.rows),
  }
}

async function packFolder($: EngineInterface, configured: string): Promise<string> {
  const dir = configured.trim()
  if (dir === '') return joinPath($.plugin.root, 'pack')
  if (dir === '~' || dir.startsWith('~/') || dir.startsWith('~\\')) {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
    return joinPath(home, dir.slice(2))
  }
  return dir
}

async function loadPack($: EngineInterface, dir: string, pictures: Pictures): Promise<Pack> {
  let manifest: string
  try {
    manifest = (await $.fs.read(joinPath(dir, 'stickers.json'))) as string
  } catch (error) {
    const problem = `cannot read ${joinPath(dir, 'stickers.json')}: ${String(error)}`
    return { dir, pictures, stickers: [], problems: [problem] }
  }
  const { entries, problems } = parseManifest(manifest)
  const stickers = await Promise.all(
    entries.map(async (entry): Promise<Sticker> => {
      const sticker: Sticker = { name: entry.name, description: entry.description, emotion: entry.emotion }
      try {
        const { base64 } = (await $.fs.read(joinPath(dir, entry.file), { as: 'bytes' })) as { base64: string }
        // An Image whose bytes are no PNG gets the whole tree refused, so check here.
        if (!base64.startsWith(PNG_SIGNATURE)) problems.push(`${entry.file} is not a PNG; "${entry.name}" shows as text`)
        else if (base64.length > MAX_PNG_BASE64) problems.push(`${entry.file} is over 2 MiB; "${entry.name}" shows as text`)
        else {
          sticker.png = base64
          sticker.file = joinPath(dir, entry.file)
        }
      } catch {
        problems.push(`cannot read ${entry.file}; "${entry.name}" shows as text`)
      }
      if (pictures === 'cells' && sticker.png !== undefined) {
        try {
          sticker.cells = cellsOf(sticker.png)
        } catch (error) {
          problems.push(`cannot decode ${entry.file} (${String(error)}); "${entry.name}" shows as text`)
        }
      }
      try {
        const svg = (await $.fs.read(joinPath(dir, entry.svg))) as string
        if (svg.length <= MAX_SVG && svg.includes('<svg')) sticker.svg = svg
      } catch {
        // The SVG is optional: surfaces without Image fall back to a text label.
      }
      return sticker
    }),
  )
  return { dir, pictures, stickers, problems }
}

/**
 * The sticker's picture on this surface, or null where only a label can show:
 * on the terminal a Raster of cells or an Image (see terminalPictures), an Svg
 * everywhere else (Image and Raster draw only on the terminal).
 */
function picture(
  table: Elements[RenderSurface],
  surface: RenderSurface,
  pictures: Pictures,
  sticker: Sticker,
  big: boolean,
  key: string,
): RenderElement | null {
  if (surface === 'terminal') {
    const { Image, Raster } = table as Elements['terminal']
    const size = big ? BIG : SMALL
    if (pictures === 'cells') {
      if (sticker.cells === undefined) return null
      return <Raster key={key} {...size} cells={big ? sticker.cells.big : sticker.cells.small} />
    }
    if (pictures === 'labels' || sticker.png === undefined) return null
    return <Image key={key} source={{ png: sticker.png }} {...size} alt={`[${sticker.name}]`} />
  }
  if (sticker.svg === undefined) return null
  const { Svg } = table as Elements['desktop']
  const px = big ? 128 : 44
  return <Svg source={sticker.svg} alt={sticker.description} width={px} height={px} />
}

async function send($: EngineInterface, sticker: Sticker): Promise<void> {
  try {
    await $.prompt.submit({ text: formatSticker(sticker), asUser: true })
  } catch (error) {
    $.ui.toast(`Could not send the sticker: ${String(error)}`)
  }
}

/** One picker window at a time: a second press while it is open does nothing. */
let isPickerOpen = false

/** Opens the picker window; resolves the sticker clicked, if any. */
async function pick($: EngineInterface): Promise<Sticker | undefined> {
  if (isPickerOpen) return undefined
  isPickerOpen = true
  try {
    const stickers = (await read($, pack))?.stickers ?? []
    const picked = await openPicker($, await detectHost($), stickers)
    if (picked.error !== undefined) $.ui.toast(`stickers: ${picked.error}`)
    return picked.sticker
  } finally {
    isPickerOpen = false
  }
}

export const register: Register = (on, options) => {
  const configuredDir = typeof options.packDir === 'string' ? options.packDir : ''
  const teachClaude = options.teachClaude !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sticker',
      description: 'Pick a sticker for the prompt (a name puts it there; list lists them)',
      argumentHint: '[name|list]',
      immediate: true,
    })
    const pictures = await terminalPictures($, options.pictures)
    const loaded = await loadPack($, await absolute($, await packFolder($, configuredDir)), pictures)
    await update($, pack, () => loaded)
    if (loaded.problems.length > 0) {
      const more = loaded.problems.length > 1 ? ` (+${loaded.problems.length - 1} more)` : ''
      $.ui.toast(`stickers: ${loaded.problems[0]}${more}`)
    }
    return next(e)
  })

  on('command.run', { command: 'sticker' }, async ($, e) => {
    const stickers = (await read($, pack))?.stickers ?? []
    if (stickers.length === 0) {
      return { text: 'No stickers are loaded. Check the "Sticker pack folder" setting in /config.' }
    }

    const query = e.args.trim()
    if (query.toLowerCase() === 'list') {
      const list = stickers.map((s, i) => `${i < 9 ? i + 1 : ' '}  ${s.name.padEnd(10)} ${s.description}`)
      return { text: ['Stickers (/sticker <name>, or a digit in the empty prompt):', ...list].join('\n') }
    }

    const sticker = query === '' ? await pick($) : findSticker(stickers, query)
    if (sticker === undefined) {
      return query === ''
        ? { text: 'No sticker picked.' }
        : { text: `No sticker "${query}". Stickers: ${stickers.map(s => s.name).join(', ')}` }
    }
    const filled = await $.prompt.fill({ text: formatSticker(sticker), mode: 'replace' })
    return {
      text: filled.isFilled
        ? `Sticker "${sticker.name}" is in the prompt; press Enter to send it.`
        : `Could not fill the prompt${filled.refusal ? ` (${filled.refusal})` : ''}. Send it as: ${formatSticker(sticker)}`,
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const stickers = (await read($, pack))?.stickers ?? []
    if (!teachClaude || stickers.length === 0) return result
    return {
      sections: [...result.sections, { id: 'stickers:palette', text: promptSection(stickers), scope: 'session' }],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const loaded = await read($, pack)
    const stickers = loaded?.stickers ?? []
    if (e.props.hasSurvey || loaded === null || stickers.length === 0) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Button } = table
    const withPictures = e.props.maxRows >= SMALL.rows + 1

    return (
      <Box key="palette" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {stickers.map((sticker, i) => {
          const button = (
            <Button
              key={`send-${sticker.name}`}
              label={sticker.name}
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={() => send($, sticker)}
            />
          )
          const art = withPictures ? picture(table, e.surface, loaded.pictures, sticker, false, `art-${sticker.name}`) : null
          return art === null ? (
            button
          ) : (
            <Box key={`item-${sticker.name}`} flexDirection="column" alignItems="center">
              {art}
              {button}
            </Box>
          )
        })}
        {e.surface === 'terminal' && (
          <Button
            key="open-picker"
            label="pictures…"
            hotkey="0"
            variant="primary"
            onPress={async () => {
              const sticker = await pick($)
              if (sticker !== undefined) await send($, sticker)
            }}
          />
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!e.props.text.includes(':sticker:')) return next(e)
    const loaded = await read($, pack)
    const segments = splitStickers(e.props.text, loaded?.stickers ?? [])
    if (loaded === null || !segments.some(s => s.kind === 'sticker')) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Markdown, Text } = table
    return (
      <Box flexDirection="column">
        {segments.map((segment, i) =>
          segment.kind === 'text' ? (
            <Markdown key={`md-${i}`} text={segment.text} />
          ) : (
            picture(table, e.surface, loaded.pictures, segment.sticker, true, `sticker-${i}`) ?? (
              <Text key={`label-${i}`} bold>
                [sticker: {segment.sticker.description}]
              </Text>
            )
          ),
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || !e.props.text.startsWith('[sticker: ')) return next(e)
    const loaded = await read($, pack)
    const sticker = loaded === null ? undefined : stickerOfMessage(e.props.text, loaded.stickers)
    const art =
      loaded === null || sticker === undefined
        ? null
        : picture($.ui.resolve(e), e.surface, loaded.pictures, sticker, true, 'sent')
    return art ?? next(e)
  })
}
