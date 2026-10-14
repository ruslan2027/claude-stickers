export type Sticker = {
  /** Lowercase id: what `/sticker <name>` and `:sticker:<name>:` name. */
  name: string
  /** What the sticker shows; sent as `[sticker: <description>]`. */
  description: string
  emotion: string
  /** The PNG, base64, for the terminal's Image. */
  png?: string
  /** SVG markup, for surfaces that draw Svg (the desktop app). */
  svg?: string
}

export type Pack = {
  /** The folder the pack was read from. */
  dir: string
  stickers: Sticker[]
  /** Why the pack (or some of it) could not be read. */
  problems: string[]
}

declare module 'claude-code' {
  interface PluginState {
    stickers: { pack: Pack | null }
  }
}
