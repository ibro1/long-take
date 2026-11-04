#!/usr/bin/env python3
"""
Draws the Long Take mark at every size the app needs.

The name is one unbroken take, so the mark is one unbroken line: a long bar with
the tally dot sitting on its head - the same amber dot the viewfinder shows
while a take is running. Viewfinder corners say "camera" without drawing a
camera, which every other app on the store already draws.

Geometry rather than a generated picture, on purpose. An icon is read at 48dp,
where a rendered image turns to mush and a shape does not: this is the same
mark, from the same numbers, at 1024 and at 48.

Everything is drawn at 4x and downsampled, which is what keeps a rounded cap and
a 3px corner clean at small sizes.
"""
from PIL import Image, ImageDraw, ImageFont
import os

INK = (244, 245, 247, 255)      # filmic.color.ink
ACCENT = (245, 181, 49, 255)    # filmic.color.accent - the one amber
DIM = (170, 175, 187, 255)      # between filmic inkMuted and ink, to survive 48dp
DARK = (14, 19, 25, 255)        # app.json backgroundColor

OUT = "assets/images"
SUPERSAMPLE = 4
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def canvas(size, background=(0, 0, 0, 0)):
    return Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), background)


def finish(img, size):
    return img.resize((size, size), Image.LANCZOS)


def draw_mark(img, size, scale=1.0, corners=True, cy_factor=0.5):
    """
    The mark, centred horizontally, drawn from the geometry of a `size` canvas.

    One shape, measured as a whole: a bullet (the tally dot) fused to a long bar
    (the take), so the silhouette is centred rather than the bar being centred
    and the dot hanging off it. `scale` pulls it in for the adaptive icon, whose
    foreground Android may crop to a circle.
    """
    d = ImageDraw.Draw(img)
    s = size * SUPERSAMPLE
    w = s * scale
    cx, cy = s / 2, s * cy_factor

    bar_h = w * 0.115
    bar_w = w * 0.615
    r = bar_h * 0.72                      # the tally bead, half again the bar
    # Total silhouette: the bead's overhang plus the bar.
    overhang = r - bar_h / 2
    total = bar_w + overhang
    left = cx - total / 2                 # leftmost point = edge of the bead
    bar_left = left + overhang

    d.rounded_rectangle(
        [bar_left, cy - bar_h / 2, bar_left + bar_w, cy + bar_h / 2],
        radius=bar_h / 2,
        fill=INK,
    )
    # The bead sits on the head of the line, its centre at the bar's cap centre.
    d.ellipse([bar_left - r, cy - r, bar_left + r, cy + r], fill=ACCENT)

    if corners:
        half_w, half_h = w * 0.44, w * 0.44
        stroke = max(2, int(w * 0.019))
        arm = w * 0.115
        for (x, y, dx, dy) in (
            (cx - half_w, cy - half_h, 1, 1),
            (cx + half_w, cy - half_h, -1, 1),
            (cx - half_w, cy + half_h, 1, -1),
            (cx + half_w, cy + half_h, -1, -1),
        ):
            d.line([(x, y), (x + arm * dx, y)], fill=DIM, width=stroke)
            d.line([(x, y), (x, y + arm * dy)], fill=DIM, width=stroke)


def icon(size, path, background=DARK, scale=1.0, corners=True):
    img = canvas(size, background)
    draw_mark(img, size, scale=scale, corners=corners)
    finish(img, size).save(path, "PNG", optimize=True)
    print(f"  {path}  {size}x{size}")


def adaptive(size, path):
    """Foreground only: the launcher supplies the colour behind it."""
    img = canvas(size)
    draw_mark(img, size, scale=0.60, corners=True)
    finish(img, size).save(path, "PNG", optimize=True)
    print(f"  {path}  {size}x{size}  transparent, inside the 66% safe circle")


def splash(size, path):
    """Mark above the wordmark, the pair centred as one group."""
    img = canvas(size, DARK)
    draw_mark(img, size, scale=0.32, corners=False, cy_factor=0.42)

    d = ImageDraw.Draw(img)
    s = size * SUPERSAMPLE
    text = "LONG TAKE"
    font = ImageFont.truetype(FONT_BOLD, int(s * 0.074))
    tracking = s * 0.019
    widths = [font.getlength(ch) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (s - total) / 2
    y = s * 0.560
    for ch, cw in zip(text, widths):
        d.text((x, y), ch, font=font, fill=INK)
        x += cw + tracking

    finish(img, size).save(path, "PNG", optimize=True)
    print(f"  {path}  {size}x{size}  mark + wordmark")


def favicon(path):
    """No corners: at 32-48px they are two grey pixels of noise."""
    size = 192
    img = canvas(size, DARK)
    draw_mark(img, size, scale=0.82, corners=False)
    finish(img, size).save(path, "PNG", optimize=True)
    print(f"  {path}  {size}x{size}  no corners")


def social(path, width=1280, height=640):
    """
    The card GitHub draws when someone shares the repository.

    Without one, every link to this project unfurls as a grey rectangle with a
    truncated title - a poor first impression for a project whose whole argument
    is that it looks after the picture.

    The mark is drawn on its own square and composited, because `draw_mark`
    centres on a square canvas of the size it is given: handing it a 1280x640
    card draws it at the card's height, four times over, off the edge.
    """
    card = Image.new("RGBA", (width, height), DARK)
    unit = min(width, height)

    square = canvas(unit, DARK)
    draw_mark(square, unit, scale=0.72, corners=False)
    side = int(unit * 0.42)
    mark = finish(square, side)
    card.paste(mark, (int((width - side) / 2), int(height * 0.13)), mark)

    d = ImageDraw.Draw(card)
    name = "LONG TAKE"
    font = ImageFont.truetype(FONT_BOLD, int(unit * 0.105))
    tracking = unit * 0.024
    widths = [font.getlength(ch) for ch in name]
    total = sum(widths) + tracking * (len(name) - 1)
    x = (width - total) / 2
    for ch, cw in zip(name, widths):
        d.text((x, height * 0.585), ch, font=font, fill=INK)
        x += cw + tracking

    tag = "Open-source camera and broadcaster for Android"
    tfont = ImageFont.truetype(FONT_BOLD, int(unit * 0.040))
    d.text(((width - tfont.getlength(tag)) / 2, height * 0.760), tag, font=tfont, fill=DIM)

    if os.path.dirname(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
    card.save(path, "PNG", optimize=True)
    print(f"  {path}  {width}x{height}  social preview")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Long Take assets:")
    icon(1024, f"{OUT}/icon.png")
    adaptive(1024, f"{OUT}/adaptive-icon.png")
    splash(1024, f"{OUT}/splash.png")
    favicon(f"{OUT}/favicon.png")
    social("assets/brand/social-preview.png")
