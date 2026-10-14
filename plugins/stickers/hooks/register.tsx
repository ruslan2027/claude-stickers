import { atom, read, update } from 'claude-code'
import type { EngineInterface, Elements, RenderElement, RenderSurface, Register } from 'claude-code'

import type { Pack, Sticker } from '../types'
import {
  findSticker,
  formatSticker,
  joinPath,
  parseManifest,
  promptSection,
  splitStickers,
  stickerOfMessage,
} from './pack'

const pack = atom({ plugin: 'stickers', key: 'pack' } as const, null)

/** PNGs past this are left to the text label (an Image takes 2 MiB at most). */
const MAX_PNG_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)
const MAX_SVG = 131_072

async function packFolder($: EngineInterface, configured: string): Promise<string> {
  const dir = configured.trim()
  if (dir === '') return joinPath($.plugin.root, 'pack')
  if (dir === '~' || dir.startsWith('~/') || dir.startsWith('~\\')) {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
    return joinPath(home, dir.slice(2))
  }
  return dir
}

async function loadPack($: EngineInterface, dir: string): Promise<Pack> {
  let manifest: string
  try {
    manifest = (await $.fs.read(joinPath(dir, 'stickers.json'))) as string
  } catch (error) {
    return { dir, stickers: [], problems: [`cannot read ${joinPath(dir, 'stickers.json')}: ${String(error)}`] }
  }
  const { entries, problems } = parseManifest(manifest)
  const stickers = await Promise.all(
    entries.map(async (entry): Promise<Sticker> => {
      const sticker: Sticker = { name: entry.name, description: entry.description, emotion: entry.emotion }
      try {
        const { base64 } = (await $.fs.read(joinPath(dir, entry.file), { as: 'bytes' })) as { base64: string }
        if (base64.length <= MAX_PNG_BASE64) sticker.png = base64
        else problems.push(`${entry.file} is over 2 MiB; "${entry.name}" shows as text`)
      } catch {
        problems.push(`cannot read ${entry.file}; "${entry.name}" shows as text`)
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
  return { dir, stickers, problems }
}

/**
 * The sticker's picture on this surface, or null where only a label can show:
 * an Image on the terminal, an Svg everywhere else (Image draws only there).
 */
function picture(
  table: Elements[RenderSurface],
  surface: RenderSurface,
  sticker: Sticker,
  big: boolean,
  key: string,
): RenderElement | null {
  if (surface === 'terminal') {
    if (sticker.png === undefined) return null
    const { Image } = table as Elements['terminal']
    return (
      <Image
        key={key}
        source={{ png: sticker.png }}
        columns={big ? 16 : 6}
        rows={big ? 8 : 3}
        alt={`[${sticker.name}]`}
      />
    )
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

export const register: Register = (on, options) => {
  const configuredDir = typeof options.packDir === 'string' ? options.packDir : ''
  const teachClaude = options.teachClaude !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sticker',
      description: 'Put a sticker in the prompt (no name: list the stickers)',
      argumentHint: '[name]',
      immediate: true,
    })
    const loaded = await loadPack($, await packFolder($, configuredDir))
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
    if (query === '') {
      const list = stickers.map((s, i) => `${i < 9 ? i + 1 : ' '}  ${s.name.padEnd(10)} ${s.description}`)
      return { text: ['Stickers (/sticker <name>, or a digit in the empty prompt):', ...list].join('\n') }
    }

    const sticker = findSticker(stickers, query)
    if (sticker === undefined) {
      return { text: `No sticker "${query}". Stickers: ${stickers.map(s => s.name).join(', ')}` }
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
    const stickers = (await read($, pack))?.stickers ?? []
    if (e.props.hasSurvey || stickers.length === 0) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Button } = table
    const withPictures = e.props.maxRows >= 5

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
          const art = withPictures ? picture(table, e.surface, sticker, false, `art-${sticker.name}`) : null
          return art === null ? (
            button
          ) : (
            <Box key={`item-${sticker.name}`} flexDirection="column" alignItems="center">
              {art}
              {button}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!e.props.text.includes(':sticker:')) return next(e)
    const stickers = (await read($, pack))?.stickers ?? []
    const segments = splitStickers(e.props.text, stickers)
    if (!segments.some(s => s.kind === 'sticker')) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Markdown, Text } = table
    return (
      <Box flexDirection="column">
        {segments.map((segment, i) =>
          segment.kind === 'text' ? (
            <Markdown key={`md-${i}`} text={segment.text} />
          ) : (
            picture(table, e.surface, segment.sticker, true, `sticker-${i}`) ?? (
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
    const sticker = stickerOfMessage(e.props.text, (await read($, pack))?.stickers ?? [])
    const art = sticker === undefined ? null : picture($.ui.resolve(e), e.surface, sticker, true, 'sent')
    return art ?? next(e)
  })
}
