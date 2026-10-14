"""Draws the default sticker pack from simple shapes.

Every sticker here is original artwork made by this script (no external
images), released under CC0 along with the rest of the default pack. Each
sticker is written twice from the same shapes: a PNG for the terminal's Image
element and an SVG for surfaces that draw Svg instead (the desktop app).

Usage: python tools/make_stickers.py [out_dir]
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256  # PNG edge in pixels
SCALE = 8  # supersampling factor for smooth edges
INK = "#2B2140"
WHITE = "#FFFFFF"


def arc(cx, cy, rx, ry, start, end, steps=24):
    """Points along an ellipse arc; angles in degrees, y pointing down."""
    out = []
    for i in range(steps + 1):
        a = math.radians(start + (end - start) * i / steps)
        out.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return out


def heart(cx, cy, s):
    pts = []
    for i in range(48):
        t = 2 * math.pi * i / 48
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * s / 16, cy - y * s / 16))
    return pts


def base(face, outline):
    return [
        ("circle", 50, 52, 46, WHITE, None, 0),
        ("circle", 50, 52, 42, face, outline, 2.5),
    ]


def eyes(dx=0, dy=0, ry=6):
    return [
        ("ellipse", 37 + dx, 44 + dy, 4, ry, INK),
        ("ellipse", 63 + dx, 44 + dy, 4, ry, INK),
    ]


def cheeks():
    return [
        ("ellipse", 28, 58, 6, 3.5, "#FF7FA0"),
        ("ellipse", 72, 58, 6, 3.5, "#FF7FA0"),
    ]


STICKERS = [
    {
        "name": "happy",
        "description": "a smiling yellow face",
        "emotion": "happy",
        "shapes": base("#FFD54A", "#E0A800")
        + eyes()
        + cheeks()
        + [("line", arc(50, 56, 17, 13, 20, 160), INK, 3.5)],
    },
    {
        "name": "love",
        "description": "a pink face with heart eyes",
        "emotion": "love",
        "shapes": base("#FFA6C1", "#E0648A")
        + [
            ("poly", heart(36, 44, 9), "#E8264F", None, 0),
            ("poly", heart(64, 44, 9), "#E8264F", None, 0),
            ("line", arc(50, 58, 15, 11, 20, 160), INK, 3.5),
        ],
    },
    {
        "name": "lol",
        "description": "an orange face laughing with eyes squeezed shut",
        "emotion": "amused",
        "shapes": base("#FFB65C", "#E07B00")
        + [
            ("line", arc(37, 47, 6, 5, 200, 340, 12), INK, 3.5),
            ("line", arc(63, 47, 6, 5, 200, 340, 12), INK, 3.5),
            ("poly", arc(50, 57, 20, 18, 0, 180), "#7A1F2B", INK, 2.5),
            ("poly", arc(50, 70, 9, 5, 180, 360, 12), "#FF7F8E", None, 0),
        ],
    },
    {
        "name": "sad",
        "description": "a blue face with a single tear",
        "emotion": "sad",
        "shapes": base("#8CC0FF", "#3F82D8")
        + eyes(dy=2, ry=5)
        + [
            ("line", [(29, 35), (41, 32)], INK, 3),
            ("line", [(71, 35), (59, 32)], INK, 3),
            ("line", arc(50, 76, 13, 9, 205, 335, 16), INK, 3.5),
            ("poly", [(66, 52)] + arc(66, 61, 4.5, 4.5, -20, 200, 16), "#3FA9FF", "#1E6FD0", 1.5),
        ],
    },
    {
        "name": "wow",
        "description": "a purple face, mouth open in surprise",
        "emotion": "surprised",
        "shapes": base("#C9A8FF", "#8A5CE0")
        + [
            ("circle", 37, 44, 7, WHITE, INK, 2.5),
            ("circle", 63, 44, 7, WHITE, INK, 2.5),
            ("circle", 37, 44, 3, INK, None, 0),
            ("circle", 63, 44, 3, INK, None, 0),
            ("line", arc(37, 36, 8, 5, 210, 330, 10), INK, 3),
            ("line", arc(63, 36, 8, 5, 210, 330, 10), INK, 3),
            ("ellipse", 50, 68, 7, 9, "#4A1E3A"),
        ],
    },
    {
        "name": "hmm",
        "description": "a teal face deep in thought, with a question mark",
        "emotion": "thinking",
        "shapes": base("#7FDCCB", "#2FA690")
        + [
            ("circle", 37, 46, 6, WHITE, INK, 2),
            ("circle", 61, 46, 6, WHITE, INK, 2),
            ("circle", 39, 43, 2.8, INK, None, 0),
            ("circle", 63, 43, 2.8, INK, None, 0),
            ("line", [(28, 36), (42, 34)], INK, 3),
            ("line", [(40, 68), (60, 64)], INK, 3.5),
            ("line", arc(84, 18, 7, 7, 190, 400, 16) + [(84, 30), (84, 33)], "#2B2140", 4),
            ("circle", 84, 40, 2.4, INK, None, 0),
        ],
    },
    {
        "name": "party",
        "description": "a green face in a party hat with confetti",
        "emotion": "celebrating",
        "shapes": [
            ("circle", 50, 56, 42, WHITE, None, 0),
            ("circle", 50, 56, 38, "#9BE38A", "#4DAE38", 2.5),
            ("poly", [(50, 2), (34, 26), (66, 26)], "#FF6F91", INK, 2),
            ("line", [(40, 18), (60, 18)], "#FFD54A", 3),
            ("circle", 50, 3, 4, "#FFD54A", INK, 1.5),
            ("ellipse", 38, 50, 4, 6, INK),
            ("ellipse", 62, 50, 4, 6, INK),
            ("line", arc(50, 62, 16, 12, 20, 160), INK, 3.5),
            ("poly", [(10, 20), (16, 18), (17, 24), (11, 26)], "#4FB3FF", None, 0),
            ("poly", [(84, 12), (90, 14), (88, 20), (82, 18)], "#FFB347", None, 0),
            ("poly", [(88, 80), (94, 82), (92, 88), (86, 86)], "#C39BFF", None, 0),
            ("poly", [(8, 76), (14, 74), (15, 80), (9, 82)], "#FF6F91", None, 0),
        ],
    },
    {
        "name": "sleepy",
        "description": "a lavender face dozing off, with Zs",
        "emotion": "tired",
        "shapes": base("#BCC2FF", "#6F78E0")
        + [
            ("line", arc(37, 46, 6, 4, 20, 160, 12), INK, 3.5),
            ("line", arc(63, 46, 6, 4, 20, 160, 12), INK, 3.5),
            ("ellipse", 50, 66, 4, 5, "#4A2E5A"),
            ("line", [(72, 10), (82, 10), (72, 20), (82, 20)], "#4A4FB0", 3),
            ("line", [(86, 24), (93, 24), (86, 31), (93, 31)], "#4A4FB0", 2.5),
        ],
    },
    {
        "name": "cool",
        "description": "a cyan face in sunglasses, smirking",
        "emotion": "confident",
        "shapes": base("#62D8EC", "#1D9CB4")
        + [
            ("line", [(22, 42), (78, 42)], INK, 3),
            ("poly", [(25, 41), (47, 41), (45, 53), (29, 54)], INK, None, 0),
            ("poly", [(53, 41), (75, 41), (71, 54), (55, 53)], INK, None, 0),
            ("line", [(30, 44), (36, 44)], "#9BEFFF", 2),
            ("line", [(58, 44), (64, 44)], "#9BEFFF", 2),
            ("line", arc(52, 60, 14, 10, 30, 130, 16), INK, 3.5),
        ],
    },
]


def draw_png(shapes, path):
    big = SIZE * SCALE
    k = big / 100
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def p(x, y):
        return (x * k, y * k)

    for s in shapes:
        kind = s[0]
        if kind == "circle":
            _, cx, cy, r, fill, stroke, sw = s
            d.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=fill,
                      outline=stroke, width=int(sw * k) if stroke else 0)
        elif kind == "ellipse":
            _, cx, cy, rx, ry, fill = s
            d.ellipse([p(cx - rx, cy - ry), p(cx + rx, cy + ry)], fill=fill)
        elif kind == "poly":
            _, pts, fill, stroke, sw = s
            d.polygon([p(*q) for q in pts], fill=fill)
            if stroke:
                ring = [p(*q) for q in pts] + [p(*pts[0])]
                d.line(ring, fill=stroke, width=int(sw * k), joint="curve")
        elif kind == "line":
            _, pts, stroke, sw = s
            w = int(sw * k)
            d.line([p(*q) for q in pts], fill=stroke, width=w, joint="curve")
            for q in (pts[0], pts[-1]):
                x, y = p(*q)
                d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=stroke)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(path, optimize=True)


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def pts_attr(pts):
    return " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)


def draw_svg(shapes, title, path):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="{SIZE}" height="{SIZE}">',
           f"<title>{title}</title>"]
    for s in shapes:
        kind = s[0]
        if kind == "circle":
            _, cx, cy, r, fill, stroke, sw = s
            st = f' stroke="{stroke}" stroke-width="{fmt(sw)}"' if stroke else ""
            out.append(f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r - (sw / 2 if stroke else 0))}" fill="{fill}"{st}/>')
        elif kind == "ellipse":
            _, cx, cy, rx, ry, fill = s
            out.append(f'<ellipse cx="{fmt(cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}" fill="{fill}"/>')
        elif kind == "poly":
            _, pts, fill, stroke, sw = s
            st = f' stroke="{stroke}" stroke-width="{fmt(sw)}" stroke-linejoin="round"' if stroke else ""
            out.append(f'<polygon points="{pts_attr(pts)}" fill="{fill}"{st}/>')
        elif kind == "line":
            _, pts, stroke, sw = s
            out.append(f'<polyline points="{pts_attr(pts)}" fill="none" stroke="{stroke}" '
                       f'stroke-width="{fmt(sw)}" stroke-linecap="round" stroke-linejoin="round"/>')
    out.append("</svg>")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "plugins" / "stickers" / "pack"
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for st in STICKERS:
        draw_png(st["shapes"], out / f"{st['name']}.png")
        draw_svg(st["shapes"], st["description"], out / f"{st['name']}.svg")
        manifest.append({k: st[k] for k in ("name", "description", "emotion")})
    (out / "stickers.json").write_text(json.dumps({"stickers": manifest}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(manifest)} stickers to {out}")


if __name__ == "__main__":
    main()
