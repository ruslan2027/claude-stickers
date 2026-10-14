export type Sticker = {
  /** Lowercase id: what `/sticker <name>` and `:sticker:<name>:` name. */
  name: string
  /** What the sticker shows; sent as `[sticker: <description>]`. */
  description: string
  emotion: string
  /** The PNG, base64, for the terminal's Image. */
  png?: string
  /** The PNG's absolute path, for the picker window. */
  file?: string
  /** SVG markup, for surfaces that draw Svg (the desktop app). */
  svg?: string
  /** The PNG as half-block cells for a terminal Raster: palette and transcript sizes. */
  cells?: { small: string; big: string }
}

/** How the terminal draws stickers: kitty-protocol Image, colored cells, or names only. */
export type Pictures = 'image' | 'cells' | 'labels'

export type Pack = {
  /** The folder the pack was read from. */
  dir: string
  /** What the terminal draws, chosen at load from the "pictures" setting. */
  pictures: Pictures
  stickers: Sticker[]
  /** Why the pack (or some of it) could not be read. */
  problems: string[]
}

declare module 'claude-code' {
  interface PluginState {
    stickers: { pack: Pack | null }
  }
}
