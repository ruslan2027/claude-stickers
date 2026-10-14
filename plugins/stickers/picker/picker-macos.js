// The sticker picker window on macOS: run with `osascript -l JavaScript`.
// Reads the stickers as JSON on stdin, [{ "name", "description", "file" }],
// and returns the chosen sticker's name, which osascript prints (nothing when
// closed). Click a sticker or press its number; Esc or the close button
// closes it. Uses only what ships with macOS (AppKit through JXA).
ObjC.import('Cocoa')

function run() {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
  const items = JSON.parse(text || '[]')
  if (items.length === 0) return ''

  const app = $.NSApplication.sharedApplication
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory)

  let choice = ''
  ObjC.registerSubclass({
    name: 'StickerPickerTarget',
    protocols: ['NSWindowDelegate'],
    methods: {
      'pick:': {
        types: ['void', ['id']],
        implementation: function (sender) {
          const tag = sender.tag
          if (tag > 0) choice = items[tag - 1].name
          app.stopModal
        },
      },
      'windowWillClose:': {
        types: ['void', ['id']],
        implementation: function () {
          app.stopModal
        },
      },
    },
  })
  const target = $.StickerPickerTarget.alloc.init

  const columns = Math.min(5, items.length)
  const rows = Math.ceil(items.length / columns)
  const cellW = 104
  const cellH = 124
  const pad = 8
  const style = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable | $.NSWindowStyleMaskUtilityWindow
  const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0, 0, columns * cellW + pad * 2, rows * cellH + pad * 2),
    style,
    $.NSBackingStoreBuffered,
    false,
  )
  panel.title = 'Stickers'
  panel.level = $.NSFloatingWindowLevel
  panel.delegate = target

  items.forEach((item, i) => {
    const x = pad + (i % columns) * cellW
    const y = pad + (rows - 1 - Math.floor(i / columns)) * cellH // AppKit counts from the bottom
    const button = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, y, cellW, cellH))
    button.bordered = false
    const image = $.NSImage.alloc.initWithContentsOfFile(item.file)
    if (image && !image.isNil()) {
      image.size = $.NSMakeSize(88, 88)
      button.image = image
    }
    button.imagePosition = $.NSImageAbove
    button.title = i < 9 ? `${i + 1}  ${item.name}` : item.name
    button.toolTip = item.description
    button.tag = i + 1
    button.target = target
    button.action = 'pick:'
    if (i < 9) button.keyEquivalent = String(i + 1)
    panel.contentView.addSubview(button)
  })

  // Esc closes: a button off to the side that answers the escape key.
  const cancel = $.NSButton.alloc.initWithFrame($.NSMakeRect(-100, -100, 1, 1))
  cancel.tag = 0
  cancel.target = target
  cancel.action = 'pick:'
  cancel.keyEquivalent = '\u001b'
  panel.contentView.addSubview(cancel)

  // Open by the mouse.
  const mouse = $.NSEvent.mouseLocation
  const frame = panel.frame
  panel.setFrameOrigin($.NSMakePoint(mouse.x - frame.size.width / 2, mouse.y + 12))

  app.activateIgnoringOtherApps(true)
  panel.makeKeyAndOrderFront(null)
  app.runModalForWindow(panel)
  panel.orderOut(null)
  return choice
}
