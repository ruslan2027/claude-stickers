"""Renders docs/demo.gif: an illustration of the palette and of a sticker
round trip, drawn from the pack's own PNGs (not a live screen capture).

Usage: python tools/make_demo.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "plugins" / "stickers" / "pack"
OUT = ROOT / "docs" / "demo.gif"

W, H = 960, 560
BG = (30, 31, 41)
FG = (220, 222, 230)
DIM = (130, 134, 150)
ACCENT = (215, 119, 87)
BORDER = (80, 84, 100)


def font(size):
    for name in ("consola.ttf", "DejaVuSansMono.ttf", "Menlo.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


F = font(17)
FS = font(14)
NAMES = [s["name"] for s in json.loads((PACK / "stickers.json").read_text())["stickers"]]
ART = {n: Image.open(PACK / f"{n}.png").convert("RGBA") for n in NAMES}


def sticker(img, name, x, y, size):
    img.alpha_composite(ART[name].resize((size, size), Image.LANCZOS), (x, y))


def frame(transcript, pressed=None, typed=""):
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((24, 16), "Claude Code", font=F, fill=ACCENT)
    d.text((150, 16), "~/projects/app", font=F, fill=DIM)

    y = 56
    for kind, value in transcript:
        if kind == "user":
            d.text((24, y), ">", font=F, fill=DIM)
            d.text((44, y), value, font=F, fill=FG)
            y += 30
        elif kind == "user-sticker":
            d.text((24, y), ">", font=F, fill=DIM)
            sticker(img, value, 44, y, 96)
            y += 108
        elif kind == "claude":
            d.text((24, y), "●", font=F, fill=FG)
            d.text((44, y), value, font=F, fill=FG)
            y += 30
        elif kind == "claude-sticker":
            sticker(img, value, 44, y, 96)
            y += 108

    # The palette band above the prompt.
    band_top = H - 190
    cell = 98
    x0 = (W - cell * len(NAMES)) // 2
    for i, name in enumerate(NAMES):
        x = x0 + i * cell
        sticker(img, name, x + 24, band_top, 50)
        label = f"{i + 1}: {name}"
        tw = d.textlength(label, font=FS)
        box = (x + 6, band_top + 58, x + cell - 6, band_top + 84)
        if pressed == name:
            d.rounded_rectangle(box, 4, fill=ACCENT)
            d.text((x + (cell - tw) / 2, band_top + 62), label, font=FS, fill=BG)
        else:
            d.rounded_rectangle(box, 4, outline=BORDER)
            d.text((x + (cell - tw) / 2, band_top + 62), label, font=FS, fill=FG)

    # The prompt box.
    d.rounded_rectangle((16, H - 84, W - 16, H - 40), 6, outline=BORDER)
    d.text((32, H - 72), "> " + typed, font=F, fill=FG)
    d.text((24, H - 30), "press 1-9 in the empty prompt, click a sticker, or /sticker <name>",
           font=FS, fill=DIM)
    return img.convert("P", palette=Image.ADAPTIVE, colors=255)


def main():
    asked = ("user", "the tests pass now, thanks!")
    reply1 = ("claude", "Nice, all 42 green. Here's to that:")
    frames = [
        (frame([]), 1200),
        (frame([], typed="the tests pass now, thanks!"), 900),
        (frame([asked, reply1, ("claude-sticker", "party")]), 1500),
        (frame([asked, reply1, ("claude-sticker", "party")], pressed="love"), 500),
        (frame([("claude-sticker", "party"), ("user-sticker", "love")]), 1200),
        (frame([("claude-sticker", "party"), ("user-sticker", "love"),
                ("claude", "Right back at you.")]), 700),
        (frame([("user-sticker", "love"),
                ("claude", "Right back at you."),
                ("claude-sticker", "cool")]), 2600),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    first, rest = frames[0][0], [f for f, _ in frames[1:]]
    first.save(OUT, save_all=True, append_images=rest, duration=[ms for _, ms in frames], loop=0, optimize=True)
    frames[-1][0].convert("RGB").save(OUT.with_name("palette.png"))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
